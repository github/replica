import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"
import {
  analyticsAuthorizationScope,
  findAnalyticsAuthorization,
  findBoundAnalyticsCallback,
} from "../../../repositories/analytics/authorization-store/index.ts"
import { getAuthenticationProofState } from "../../../repositories/authentication-providers/get-authentication-proof-state/index.ts"
import { lockAuthenticationProvidersForPrototypeEdit } from "../../../repositories/authentication-providers/lock-authentication-providers-for-prototype-edit/index.ts"
import { lockGitHubRepositoryAccessState } from "../../../repositories/github-repository-access-states/lock-github-repository-access-state/index.ts"
import { lockSessionRevocationState } from "../../../repositories/session-revocation-states/lock-session-revocation-state/index.ts"
import { AuthenticationProofError } from "../../authentication/errors.ts"
import { hashAuthenticationValue } from "../../authentication/hash-authentication-value/index.ts"
import type {
  AnalyticsMutation,
  createAnalyticsDestinationService,
} from "../create-destination-service/index.ts"
import { AnalyticsSettingsError } from "../errors.ts"
import { openPendingAnalyticsChange, sealPendingAnalyticsChange } from "./protect-intent.ts"
import type { LiveRepositoryPermission, RepositoryAnalyticsProof } from "./types.ts"

type Authorization = NonNullable<Awaited<ReturnType<typeof findAnalyticsAuthorization>>>
type Viewer = Parameters<LiveRepositoryPermission>[0] & { userId: string }
type Session = Viewer & {
  sessionId: string
  externalIdentityId: string
  accessRevision: number
  githubRepositoryId: bigint
  providerRevisionId: string
  sessionRevocationRevision: number
}

function unavailable() {
  return new AnalyticsSettingsError(404, "Analytics authorization is no longer available.")
}

function sameAuthority(expected: Session, current: Session | null) {
  return (
    current &&
    current.sessionId === expected.sessionId &&
    current.externalIdentityId === expected.externalIdentityId &&
    current.membershipId === expected.membershipId &&
    current.accessRevision === expected.accessRevision &&
    current.githubRepositoryId === expected.githubRepositoryId &&
    current.providerRevisionId === expected.providerRevisionId &&
    current.sessionRevocationRevision === expected.sessionRevocationRevision
  )
}

function belongsTo(session: Session, authorization: Authorization) {
  return (
    authorization.hubSessionId === session.sessionId &&
    authorization.externalIdentityId === session.externalIdentityId
  )
}

function currentAttempt(session: Session, authorization: Authorization) {
  return (
    authorization.attempt.purpose === "REPOSITORY_ANALYTICS" &&
    authorization.attempt.providerRevisionId === session.providerRevisionId &&
    authorization.attempt.sessionRevocationRevision === session.sessionRevocationRevision &&
    authorization.attempt.expiresAt.getTime() > Date.now()
  )
}

function fresh(authorization: Authorization) {
  const age = authorization.verifiedAt ? Date.now() - authorization.verifiedAt.getTime() : Infinity
  return (
    authorization.attempt.consumedAt !== null &&
    age >= 0 &&
    age < 5 * 60_000 &&
    authorization.attempt.expiresAt.getTime() > Date.now()
  )
}

export function createHostedAnalyticsAuthorization(
  database: PrismaClient,
  destinations: ReturnType<typeof createAnalyticsDestinationService>,
  encryptionKey: Buffer,
  dependencies: {
    restoreSession(tx: Prisma.TransactionClient, sessionDigest: string): Promise<Viewer | null>
    getRepositoryPermission: LiveRepositoryPermission
  },
) {
  async function capture(
    tx: Prisma.TransactionClient,
    digest: string,
    repositoryId: string,
  ): Promise<Session | null> {
    await lockAuthenticationProvidersForPrototypeEdit(tx)
    await lockSessionRevocationState(tx)
    const { revision: accessRevision } = await lockGitHubRepositoryAccessState(tx)
    const viewer = await dependencies.restoreSession(tx, digest)
    if (viewer?.sessionProvider !== "github" || !viewer.externalIdentityId) return null
    const [session, proofState, repository] = await Promise.all([
      tx.hubSession.findUnique({ where: { digest }, select: { id: true } }),
      getAuthenticationProofState(tx, "github"),
      tx.repository.findFirst({
        where: {
          id: repositoryId,
          removedAt: null,
          githubRepositoryId: { not: null },
          localPath: null,
        },
        select: { githubRepositoryId: true },
      }),
    ])
    if (!session || repository?.githubRepositoryId == null || !proofState?.selectedProviderRevision)
      return null
    return {
      ...viewer,
      externalIdentityId: viewer.externalIdentityId,
      sessionId: session.id,
      accessRevision,
      githubRepositoryId: repository.githubRepositoryId,
      providerRevisionId: proofState.selectedProviderRevision.id,
      sessionRevocationRevision: proofState.sessionRevocationRevision,
    }
  }

  async function requireLiveAdmin(digest: string, repositoryId: string, authorizationId?: string) {
    const session = await database.$transaction((tx) => capture(tx, digest, repositoryId))
    if (!session) throw unavailable()
    let granted = false
    try {
      granted = (await dependencies.getRepositoryPermission(session, repositoryId)) === "admin"
    } finally {
      if (!granted && authorizationId) {
        await database.analyticsDestinationAuthorization.deleteMany({
          where: {
            id: authorizationId,
            repositoryId,
            hubSessionId: session.sessionId,
            externalIdentityId: session.externalIdentityId,
          },
        })
      }
    }
    if (!granted) throw unavailable()
    return session
  }

  return {
    async start(
      proof: RepositoryAnalyticsProof,
      repositoryId: string,
      digest: string,
      mutation: AnalyticsMutation,
    ) {
      const session = await requireLiveAdmin(digest, repositoryId)
      return proof.start(async (tx, attempt) => {
        const current = await capture(tx, digest, repositoryId)
        if (
          !sameAuthority(session, current) ||
          attempt.providerRevisionId !== session.providerRevisionId ||
          attempt.sessionRevocationRevision !== session.sessionRevocationRevision
        )
          throw unavailable()
        const targetUpdatedAt = await destinations.prepare(tx, repositoryId, mutation)
        const scope = {
          id: attempt.id,
          repositoryId,
          hubSessionId: session.sessionId,
          externalIdentityId: session.externalIdentityId,
        }
        const mutationCiphertext = sealPendingAnalyticsChange(
          scope,
          { mutation, targetUpdatedAt },
          encryptionKey,
        )
        await tx.analyticsDestinationAuthorization.deleteMany({
          where: { hubSessionId: session.sessionId },
        })
        await tx.analyticsDestinationAuthorization.create({
          data: { ...scope, mutationCiphertext },
        })
      })
    },

    async complete(
      proof: RepositoryAnalyticsProof,
      input: { browserBinding: string; state: string; code?: string; digest: string | null },
    ): Promise<{ redirect: string } | null> {
      const authorization = await findBoundAnalyticsCallback(
        database,
        hashAuthenticationValue(input.state),
        hashAuthenticationValue(input.browserBinding),
      )
      if (!authorization) return null
      const { id, repositoryId } = authorization
      const path = `/repositories/${repositoryId}/analytics`
      const digest = input.digest
      const session = digest
        ? await database.$transaction((tx) => capture(tx, digest, repositoryId))
        : null
      if (!digest || !session || !belongsTo(session, authorization)) {
        await database.analyticsDestinationAuthorization.deleteMany({
          where: { id, verifiedAt: null },
        })
        return { redirect: "/?authentication=denied" }
      }
      if (!currentAttempt(session, authorization) || !input.code) {
        await database.analyticsDestinationAuthorization.deleteMany({
          where: { id, verifiedAt: null },
        })
        return { redirect: `${path}?authorization=cancelled` }
      }
      if (authorization.attempt.consumedAt) {
        return {
          redirect: fresh(authorization)
            ? `${path}?authorizationId=${id}`
            : `${path}?authorization=unavailable`,
        }
      }
      try {
        const verified = await proof.complete(
          { browserBinding: input.browserBinding, state: input.state, code: input.code },
          async (evidence) => {
            const identity = await database.externalIdentity.findFirst({
              where: {
                id: authorization.externalIdentityId,
                provider: "github",
                issuer: evidence.issuer,
                subject: evidence.subject,
                userId: session.userId,
              },
              select: { id: true, userId: true },
            })
            if (
              !identity ||
              evidence.provider !== "github" ||
              evidence.authorizationAttemptId !== id
            ) {
              throw new AuthenticationProofError(
                "provider_failed",
                "Verify the GitHub account used to start this change.",
              )
            }
            return { externalIdentityId: identity.id, userId: identity.userId }
          },
        )
        if (
          verified.authorizationAttemptId !== id ||
          verified.externalIdentityId !== authorization.externalIdentityId
        )
          throw unavailable()
        const result = await database.$transaction(async (tx) => {
          const current = await capture(tx, digest, repositoryId)
          const pending = await findAnalyticsAuthorization(tx, id, repositoryId)
          if (
            !current ||
            !sameAuthority(session, current) ||
            !pending ||
            !currentAttempt(current, pending) ||
            !pending.attempt.consumedAt
          )
            return false
          const updated = await tx.analyticsDestinationAuthorization.updateMany({
            where: { id, hubSessionId: session.sessionId, verifiedAt: null },
            data: { verifiedAt: new Date() },
          })
          return updated.count === 1
        })
        if (!result) throw unavailable()
        return { redirect: `${path}?authorizationId=${id}` }
      } catch (error) {
        // A duplicate callback can lose the V2 consume race while its first submission is verifying.
        if (!(error instanceof AuthenticationProofError) || error.code !== "attempt_invalid") {
          await database.analyticsDestinationAuthorization.deleteMany({
            where: { id, verifiedAt: null },
          })
        }
        return { redirect: `${path}?authorization=unavailable` }
      }
    },

    async status(repositoryId: string, id: string, digest: string) {
      return database.$transaction(async (tx) => {
        const current = await capture(tx, digest, repositoryId)
        const pending = await findAnalyticsAuthorization(tx, id, repositoryId)
        if (
          !current ||
          !pending ||
          !belongsTo(current, pending) ||
          !currentAttempt(current, pending) ||
          !fresh(pending)
        )
          return null
        return {
          id,
          expiresAt: new Date(
            Math.min(
              pending.attempt.expiresAt.getTime(),
              pending.verifiedAt!.getTime() + 5 * 60_000,
            ),
          ).toISOString(),
        }
      })
    },

    async cancel(repositoryId: string, id: string, digest: string) {
      return database.$transaction(async (tx) => {
        const current = await capture(tx, digest, repositoryId)
        if (!current) throw unavailable()
        const removed = await tx.analyticsDestinationAuthorization.deleteMany({
          where: {
            id,
            repositoryId,
            hubSessionId: current.sessionId,
            externalIdentityId: current.externalIdentityId,
          },
        })
        if (!removed.count) throw unavailable()
        return { id }
      })
    },

    async continue(repositoryId: string, id: string, digest: string) {
      const session = await requireLiveAdmin(digest, repositoryId, id)
      const claimed = await database.$transaction(async (tx) => {
        const current = await capture(tx, digest, repositoryId)
        const pending = await tx.analyticsDestinationAuthorization.findUnique({
          where: { id, repositoryId, hubSessionId: session.sessionId },
          select: { ...analyticsAuthorizationScope, mutationCiphertext: true },
        })
        if (
          !current ||
          !sameAuthority(session, current) ||
          !pending ||
          !belongsTo(current, pending) ||
          !currentAttempt(current, pending) ||
          !fresh(pending)
        )
          throw unavailable()
        const removed = await tx.analyticsDestinationAuthorization.deleteMany({
          where: { id, hubSessionId: session.sessionId },
        })
        if (removed.count !== 1) throw unavailable()
        return pending
      })
      const { mutation, targetUpdatedAt } = openPendingAnalyticsChange(claimed, encryptionKey)
      return destinations.mutate(
        { membershipId: session.membershipId, repositoryId },
        mutation,
        async (tx) => {
          const current = await capture(tx, digest, repositoryId)
          return Boolean(
            current &&
            sameAuthority(session, current) &&
            currentAttempt(current, claimed) &&
            fresh(claimed),
          )
        },
        targetUpdatedAt,
      )
    },
  }
}
