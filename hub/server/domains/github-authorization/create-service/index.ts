import { createHmac, timingSafeEqual } from "node:crypto"
import { z } from "zod"

import { createIdentityRecords } from "#server/domains/identity/create-records"
import type { IdentityStore } from "#server/domains/identity/create-store/types"
import { getCurrentSession } from "#server/domains/authentication/get-current-session"
import { createGitHubIntegrationCredentialProvider } from "#server/domains/github-integration/create-credential-provider"
import {
  mapGitHubPermission,
  type GitHubRepositoryPermission,
} from "#server/domains/github-authorization/map-permission"
import type {
  GitHubAdmissionBaseline,
  GitHubAuthorizationService,
  GitHubPrototypeBaseline,
} from "#server/domains/github-authorization/create-service/types"
import {
  collaboratorPermissionSchema,
  githubUserSchema,
  repositorySchema,
} from "#server/integrations/github/check-repository-admission/constants"
import { createInstallationToken } from "#server/integrations/github/create-installation-token"
import { GitHubApiError } from "#server/integrations/github/github-api-error"
import { log } from "#server/integrations/pino/log"
import { requestGitHubApi } from "#server/integrations/github/request-github-api"
import type { GitHubCredentials } from "#server/integrations/github/validate-github-credentials/types"
import { saveSecurityAudit } from "#server/repositories/security-audits/save-audit"
import { AuthenticationError } from "#server/utils/authentication-error"

import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"

const policyId = "00000000-0000-0000-0000-000000000001"
const repositoryIdSchema = z.string().regex(/^[1-9]\d{0,19}$/)
const identifierSchema = z.uuid()
const linkSchema = z.object({
  githubRepositoryId: repositoryIdSchema,
  admissionEnabled: z.boolean().optional(),
})
const updateSchema = z.object({ admissionEnabled: z.boolean() })
const webhookSchema = z.object({
  action: z.string().optional(),
  installation: z.object({ id: z.number().int().positive() }),
  repository: z
    .object({
      id: z.number().int().positive(),
      name: z.string().min(1),
      owner: z.object({ login: z.string().min(1) }),
      default_branch: z.string().min(1).optional(),
    })
    .optional(),
  repositories_added: z.array(z.object({ id: z.number().int().positive() })).optional(),
  repositories_removed: z.array(z.object({ id: z.number().int().positive() })).optional(),
})

async function lastKnownGoodSeconds(
  database: Prisma.TransactionClient | PrismaClient,
): Promise<number> {
  return (
    (
      await database.gitHubAuthorizationPolicy.findUnique({
        where: { id: policyId },
        select: { lastKnownGoodSeconds: true },
      })
    )?.lastKnownGoodSeconds ?? 86_400
  )
}

function authenticationDependencies(store: IdentityStore) {
  return {
    store,
    github: null,
    configuration: null,
    providerRevisionId: null,
    admissionPolicy: { name: "hub-managed" as const, admit: () => Promise.resolve(null) },
    now: () => new Date(),
  }
}

async function currentAdministrator(
  store: IdentityStore,
  sessionToken: string,
  database?: Prisma.TransactionClient,
  requireFresh = true,
) {
  const actor = await getCurrentSession(
    authenticationDependencies(store),
    sessionToken,
    database ? createIdentityRecords(database) : store.read,
  )
  if (
    actor.membership.role !== "administrator" ||
    (requireFresh &&
      (!actor.freshAuthorizedAt || Date.now() - actor.freshAuthorizedAt.getTime() >= 5 * 60_000))
  ) {
    throw new AuthenticationError(
      403,
      actor.membership.role === "administrator"
        ? "fresh_authorization_required"
        : "installation_administrator_required",
      actor.membership.role === "administrator"
        ? "Verify your identity again."
        : "Installation administrator access is required.",
    )
  }
  return actor
}

async function credentials(
  store: IdentityStore,
  provider: ReturnType<typeof createGitHubIntegrationCredentialProvider>,
): Promise<GitHubCredentials> {
  const value = provider.read(await store.read.githubIntegrationCredentials())
  if (!value) {
    throw new AuthenticationError(
      503,
      "source_integration_unconfigured",
      "GitHub source integration is not configured.",
    )
  }
  return value
}

async function permissionFor(
  token: string,
  username: string,
  subject: string,
  fullName: string,
  visibility: string,
): Promise<GitHubRepositoryPermission> {
  try {
    if (visibility !== "private") {
      try {
        await requestGitHubApi(
          `/repos/${fullName}/collaborators/${encodeURIComponent(username)}`,
          token,
        )
      } catch (error) {
        if (error instanceof GitHubApiError && error.status === 404) return "none"
        throw error
      }
    }
    const response = collaboratorPermissionSchema.parse(
      await requestGitHubApi(
        `/repos/${fullName}/collaborators/${encodeURIComponent(username)}/permission`,
        token,
      ),
    )
    if (String(response.user.id) !== subject) {
      return "none"
    }

    return normalizePermission(response.permission, response.role_name)
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return "none"
    throw error
  }
}

async function currentUsername(token: string, subject: string): Promise<string | null> {
  try {
    const user = githubUserSchema.parse(await requestGitHubApi(`/user/${subject}`, token))
    return String(user.id) === subject ? user.login : null
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return null
    throw error
  }
}

function normalizePermission(
  permission: GitHubRepositoryPermission,
  roleName?: string | null,
): GitHubRepositoryPermission {
  if (roleName && ["admin", "maintain", "write", "triage", "read"].includes(roleName)) {
    return roleName as GitHubRepositoryPermission
  }
  return permission
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  operation: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  for (let index = 0; index < items.length; index += limit) {
    results.push(...(await Promise.all(items.slice(index, index + limit).map(operation))))
  }
  return results
}

async function lockRepository(database: Prisma.TransactionClient, id: string): Promise<void> {
  await database.$queryRaw`
    SELECT "id" FROM "github_repository_sources" WHERE "id" = ${id}::uuid FOR UPDATE
  `
}

async function saveBaseline(
  database: Prisma.TransactionClient,
  userId: string,
  baseline: GitHubAdmissionBaseline,
  requireAdmissionEnabled = false,
  skipOlderConfirmation = false,
  requireAdmissionAttempt = true,
): Promise<"saved" | "superseded"> {
  await lockRepository(database, baseline.repositorySourceId)
  const source = await database.gitHubRepositorySource.findUnique({
    where: { id: baseline.repositorySourceId },
    select: {
      status: true,
      admissionEnabled: true,
      synchronizationGeneration: true,
    },
  })
  if (
    !source ||
    source.status !== "active" ||
    (requireAdmissionEnabled && !source.admissionEnabled) ||
    source.synchronizationGeneration !== baseline.sourceGeneration
  ) {
    throw new AuthenticationError(
      409,
      "github_authorization_changed",
      "GitHub authorization changed. Start again.",
    )
  }
  if (!baseline.persist) {
    const cutoff = new Date(Date.now() - (await lastKnownGoodSeconds(database)) * 1_000)
    const cached = await database.gitHubSynchronizedAccess.findUnique({
      where: {
        repositorySourceId_userId: {
          repositorySourceId: baseline.repositorySourceId,
          userId,
        },
      },
    })
    if (
      !cached ||
      cached.status !== "active" ||
      !cached.admissionEligible ||
      cached.rawPermission !== baseline.rawPermission ||
      cached.lastConfirmedAt.getTime() !== baseline.confirmedAt.getTime() ||
      cached.lastConfirmedAt < cutoff
    ) {
      throw new AuthenticationError(
        409,
        "github_authorization_changed",
        "GitHub authorization changed. Start again.",
      )
    }
    return "saved"
  }
  if (requireAdmissionAttempt) {
    const attempt = await database.gitHubAdmissionAttempt.findUnique({
      where: {
        repositorySourceId_subject: {
          repositorySourceId: baseline.repositorySourceId,
          subject: baseline.subject,
        },
      },
      select: { generation: true },
    })
    if (!attempt || attempt.generation !== baseline.admissionGeneration) {
      if (skipOlderConfirmation) return "superseded"
      throw new AuthenticationError(
        409,
        "github_authorization_changed",
        "GitHub authorization changed. Start again.",
      )
    }
  }
  const existing = await database.gitHubSynchronizedAccess.findUnique({
    where: {
      repositorySourceId_userId: {
        repositorySourceId: baseline.repositorySourceId,
        userId,
      },
    },
    select: { lastConfirmedAt: true },
  })
  if (existing && existing.lastConfirmedAt > baseline.confirmedAt) {
    if (skipOlderConfirmation) return "superseded"
    throw new AuthenticationError(
      409,
      "github_authorization_changed",
      "GitHub authorization changed. Start again.",
    )
  }
  await database.gitHubSynchronizedAccess.upsert({
    where: {
      repositorySourceId_userId: {
        repositorySourceId: baseline.repositorySourceId,
        userId,
      },
    },
    create: {
      repositorySourceId: baseline.repositorySourceId,
      userId,
      rawPermission: baseline.rawPermission,
      mappedPrototypeRole: baseline.prototypeRole,
      admissionEligible: baseline.admissionEligible,
      status: baseline.admissionEligible ? "active" : "removed",
      synchronizationStatus: baseline.admissionEligible ? "current" : "removed",
      lastConfirmedAt: baseline.confirmedAt,
      removedAt: baseline.admissionEligible ? null : baseline.confirmedAt,
    },
    update: {
      rawPermission: baseline.rawPermission,
      mappedPrototypeRole: baseline.prototypeRole,
      admissionEligible: baseline.admissionEligible,
      status: baseline.admissionEligible ? "active" : "removed",
      synchronizationStatus: baseline.admissionEligible ? "current" : "removed",
      lastConfirmedAt: baseline.confirmedAt,
      removedAt: baseline.admissionEligible ? null : baseline.confirmedAt,
    },
  })
  return "saved"
}

async function enforceSynchronizedMemberships(
  database: Prisma.TransactionClient,
  at: Date,
): Promise<void> {
  const cutoff = new Date(at.getTime() - (await lastKnownGoodSeconds(database)) * 1_000)
  const synchronizedMemberships = await database.installationMembership.findMany({
    where: {
      source: "synchronized",
      status: "active",
      user: {
        githubSynchronizedAccess: {
          none: {
            status: "active",
            admissionEligible: true,
            lastConfirmedAt: { gte: cutoff },
            repositorySource: { status: "active", admissionEnabled: true },
          },
        },
      },
    },
    select: { id: true, userId: true, role: true },
  })
  for (const membership of synchronizedMemberships) {
    const [workspaceAdministration, prototypeAdministration] = await Promise.all([
      database.workspaceAccessGrant.findFirst({
        where: {
          userId: membership.userId,
          effect: "allow",
          role: "administrator",
        },
        select: { id: true },
      }),
      database.prototypeAccessGrant.findFirst({
        where: {
          userId: membership.userId,
          effect: "allow",
          role: "administrator",
        },
        select: { id: true },
      }),
    ])
    if (membership.role === "administrator" || workspaceAdministration || prototypeAdministration) {
      const preserved = await database.installationMembership.updateMany({
        where: {
          id: membership.id,
          source: "synchronized",
          status: "active",
        },
        data: { source: "manual" },
      })
      if (preserved.count > 0) {
        await saveSecurityAudit(database, {
          event: "membership.synchronized.preserve",
          actorUserId: null,
          sessionId: null,
          authenticationProviderRevisionId: null,
          targetMembershipId: membership.id,
          context: { reason: "manual_administration" },
        })
      }
      continue
    }
    const removed = await database.installationMembership.updateMany({
      where: {
        id: membership.id,
        source: "synchronized",
        status: "active",
      },
      data: { status: "removed", removedAt: at },
    })
    if (removed.count === 0) continue
    await database.session.deleteMany({ where: { userId: membership.userId } })
    await saveSecurityAudit(database, {
      event: "membership.synchronized.remove",
      actorUserId: null,
      sessionId: null,
      authenticationProviderRevisionId: null,
      targetMembershipId: membership.id,
      context: { reason: "github_access_lost" },
    })
  }
}

async function removeRepositorySource(
  database: Prisma.TransactionClient,
  repositorySourceId: string,
  removedAt: Date,
  enforceMemberships = true,
): Promise<void> {
  await lockRepository(database, repositorySourceId)
  await database.gitHubRepositorySource.update({
    where: { id: repositorySourceId },
    data: {
      status: "removed",
      admissionEnabled: false,
      synchronizationGeneration: { increment: 1 },
      synchronizationStatus: "removed",
      removedAt,
    },
  })
  await database.gitHubSynchronizedAccess.updateMany({
    where: { repositorySourceId },
    data: { status: "removed", synchronizationStatus: "removed", removedAt },
  })
  if (enforceMemberships) await enforceSynchronizedMemberships(database, removedAt)
}

async function removeInstallationSources(
  database: Prisma.TransactionClient,
  snapshots: Array<{ id: string; synchronizationGeneration: number }>,
  removedAt: Date,
): Promise<void> {
  for (const snapshot of snapshots) {
    await lockRepository(database, snapshot.id)
    const current = await database.gitHubRepositorySource.findUnique({
      where: { id: snapshot.id },
      select: { status: true, synchronizationGeneration: true },
    })
    if (
      !current ||
      !["active", "suspended"].includes(current.status) ||
      current.synchronizationGeneration !== snapshot.synchronizationGeneration
    ) {
      continue
    }
    await removeRepositorySource(database, snapshot.id, removedAt, false)
  }
  await enforceSynchronizedMemberships(database, removedAt)
}

async function suspendInstallationSources(
  database: Prisma.TransactionClient,
  installationId: string,
  suspendedAt: Date,
): Promise<void> {
  const sources = await database.gitHubRepositorySource.findMany({
    where: { installationId, status: "active" },
    select: { id: true },
  })
  for (const { id } of sources) await lockRepository(database, id)
  await database.gitHubRepositorySource.updateMany({
    where: { installationId, status: "active" },
    data: {
      status: "suspended",
      synchronizationGeneration: { increment: 1 },
      synchronizationStatus: "removed",
      removedAt: suspendedAt,
    },
  })
  await database.gitHubSynchronizedAccess.updateMany({
    where: { repositorySource: { installationId } },
    data: { status: "removed", synchronizationStatus: "removed", removedAt: suspendedAt },
  })
  await enforceSynchronizedMemberships(database, suspendedAt)
}

async function resumeInstallationSources(
  database: Prisma.TransactionClient,
  installationId: string,
  resumedAt: Date,
): Promise<void> {
  const sources = await database.gitHubRepositorySource.findMany({
    where: { installationId, status: "suspended" },
    select: { id: true },
  })
  for (const { id } of sources) await lockRepository(database, id)
  await database.gitHubRepositorySource.updateMany({
    where: { installationId, status: "suspended" },
    data: {
      status: "active",
      synchronizationGeneration: { increment: 1 },
      synchronizationStatus: "dirty",
      synchronizationError: null,
      removedAt: null,
      dirtyAt: resumedAt,
    },
  })
}

export function createGitHubAuthorizationService({
  database,
  environment,
  store,
}: {
  database: PrismaClient
  environment: NodeJS.ProcessEnv
  store: IdentityStore
}): GitHubAuthorizationService {
  const webhookSecret = environment.HUB_GITHUB_WEBHOOK_SECRET ?? null
  if (webhookSecret && (webhookSecret.length < 20 || webhookSecret.length > 1024)) {
    throw new Error("HUB_GITHUB_WEBHOOK_SECRET must contain between 20 and 1024 characters.")
  }
  let reconciliationDueRunning = false
  const dirtyRetrySources = new Set<string>()
  let dirtyRetryTimer: NodeJS.Timeout | null = null
  let dirtyRetryRunning = false

  async function sourceCredentials() {
    return credentials(store, createGitHubIntegrationCredentialProvider(environment))
  }

  function scheduleDirtyReconciliation(sourceIds: string[]) {
    for (const sourceId of sourceIds) dirtyRetrySources.add(sourceId)
    if (dirtyRetryTimer || dirtyRetryRunning || dirtyRetrySources.size === 0) return
    dirtyRetryTimer = setTimeout(() => {
      dirtyRetryTimer = null
      dirtyRetryRunning = true
      void (async () => {
        while (dirtyRetrySources.size > 0) {
          const sourceIds = [...dirtyRetrySources].slice(0, 4)
          for (const sourceId of sourceIds) dirtyRetrySources.delete(sourceId)
          const results = await Promise.allSettled(sourceIds.map((sourceId) => reconcile(sourceId)))
          results.forEach((result, index) => {
            if (result.status === "rejected") {
              log("error", "GitHub authorization dirty retry failed", {
                repositorySourceId: sourceIds[index],
                reason: "reconciliation_failed",
              })
            }
          })
        }
      })().finally(() => {
        dirtyRetryRunning = false
        if (dirtyRetrySources.size > 0) scheduleDirtyReconciliation([])
      })
    }, 1_000)
    dirtyRetryTimer.unref()
  }

  async function claimAdmissionGeneration(
    repositorySourceId: string,
    subject: string,
    observedSourceGeneration: number,
    requireAdmissionEnabled: boolean,
  ) {
    return database.$transaction(async (transaction) => {
      await lockRepository(transaction, repositorySourceId)
      const source = await transaction.gitHubRepositorySource.findUnique({
        where: { id: repositorySourceId },
      })
      if (!source || source.status !== "active") return { status: "denied" as const }
      if (requireAdmissionEnabled && !source.admissionEnabled) return { status: "denied" as const }
      if (source.synchronizationGeneration !== observedSourceGeneration) {
        return { status: "changed" as const }
      }
      const attempt = await transaction.gitHubAdmissionAttempt.upsert({
        where: { repositorySourceId_subject: { repositorySourceId, subject } },
        create: { repositorySourceId, subject, generation: 1 },
        update: { generation: { increment: 1 } },
      })
      return { status: "claimed" as const, source, admissionGeneration: attempt.generation }
    })
  }

  async function reconcile(repositorySourceId: string, actorSessionToken?: string) {
    const source = await database.$transaction(async (transaction) => {
      await lockRepository(transaction, repositorySourceId)
      const current = await transaction.gitHubRepositorySource.findUnique({
        where: { id: repositorySourceId },
      })
      if (!current || current.status !== "active") {
        throw new AuthenticationError(
          404,
          "repository_source_not_found",
          "The repository link was not found.",
        )
      }

      const attemptedAt = new Date()
      return transaction.gitHubRepositorySource.update({
        where: { id: current.id },
        data: {
          synchronizationGeneration: { increment: 1 },
          lastAttemptedAt: attemptedAt,
          synchronizationStatus: "dirty",
          synchronizationError: null,
          dirtyAt: attemptedAt,
        },
      })
    })
    const installationSnapshots = await database.gitHubRepositorySource.findMany({
      where: {
        appId: source.appId,
        installationId: source.installationId,
        status: { in: ["active", "suspended"] },
      },
      select: { id: true, synchronizationGeneration: true },
    })
    let phase: "credentials" | "token" | "repository" | "permissions" | "apply" = "credentials"
    try {
      const integration = await sourceCredentials()
      if (
        integration.appId !== source.appId ||
        integration.installationId !== source.installationId
      ) {
        throw new AuthenticationError(
          409,
          "repository_source_configuration_changed",
          "The GitHub source integration configuration changed. Relink the repository.",
        )
      }
      phase = "token"
      const token = await createInstallationToken(integration)
      phase = "repository"
      const repository = repositorySchema.parse(
        await requestGitHubApi(`/repositories/${source.githubRepositoryId}`, token),
      )
      phase = "permissions"
      const identities = []
      let identityCursor: string | undefined
      while (true) {
        const page = await database.externalIdentity.findMany({
          where: {
            provider: "github",
            issuer: "https://github.com",
            username: { not: null },
            user: { memberships: { some: { status: "active" } } },
          },
          select: { id: true, userId: true, subject: true, username: true },
          orderBy: { id: "asc" },
          ...(identityCursor ? { cursor: { id: identityCursor }, skip: 1 } : {}),
          take: 100,
        })
        identities.push(...page)
        if (page.length < 100) break
        identityCursor = page.at(-1)?.id
      }
      const results = await mapWithConcurrency(identities, 10, async (identity) => {
        const claim = await claimAdmissionGeneration(
          source.id,
          identity.subject,
          source.synchronizationGeneration,
          false,
        )
        if (claim.status !== "claimed") return null
        try {
          const username = await currentUsername(token, identity.subject)
          if (!username) {
            return {
              status: "confirmed" as const,
              userId: identity.userId,
              subject: identity.subject,
              admissionGeneration: claim.admissionGeneration,
              rawPermission: "none" as const,
              confirmedAt: new Date(),
              ...mapGitHubPermission("none"),
            }
          }
          const rawPermission = await permissionFor(
            token,
            username,
            identity.subject,
            repository.full_name,
            repository.visibility,
          )
          return {
            status: "confirmed" as const,
            userId: identity.userId,
            subject: identity.subject,
            admissionGeneration: claim.admissionGeneration,
            rawPermission,
            confirmedAt: new Date(),
            ...mapGitHubPermission(rawPermission),
          }
        } catch {
          return { status: "failed" as const }
        }
      })
      const partialFailure = results.some((result) => result?.status === "failed")
      const confirmedAt = results.reduce<Date | null>(
        (latest, result) =>
          result?.status === "confirmed" &&
          (!latest || result.confirmedAt.getTime() > latest.getTime())
            ? result.confirmedAt
            : latest,
        null,
      )
      phase = "apply"
      const actor = actorSessionToken
        ? await currentAdministrator(store, actorSessionToken, undefined, false)
        : null
      const confirmedResults = results.filter(
        (result): result is NonNullable<typeof result> & { status: "confirmed" } =>
          result?.status === "confirmed",
      )
      for (let index = 0; index < confirmedResults.length; index += 50) {
        const batch = confirmedResults.slice(index, index + 50)
        await database.$transaction(async (transaction) => {
          await lockRepository(transaction, source.id)
          const current = await transaction.gitHubRepositorySource.findUnique({
            where: { id: source.id },
          })
          if (
            !current ||
            current.status !== "active" ||
            current.synchronizationGeneration !== source.synchronizationGeneration
          ) {
            return
          }
          for (const result of batch) {
            await saveBaseline(
              transaction,
              result.userId,
              {
                repositorySourceId: source.id,
                sourceGeneration: source.synchronizationGeneration,
                subject: result.subject,
                admissionGeneration: result.admissionGeneration,
                persist: true,
                rawPermission: result.rawPermission,
                admissionEligible: result.admissionEligible,
                prototypeRole: result.prototypeRole,
                confirmedAt: result.confirmedAt,
              },
              false,
              true,
              true,
            )
          }
          await saveSecurityAudit(transaction, {
            event: "github.repository.reconcile.batch",
            actorUserId: actor?.userId ?? null,
            sessionId: actor?.id ?? null,
            authenticationProviderRevisionId: actor?.authenticationProviderRevisionId ?? null,
            githubRepositorySourceId: source.id,
            context: { source: "github_app_installation" },
          })
        })
      }
      const applied = await store.lock(async (_records, transaction) => {
        await lockRepository(transaction, source.id)
        const current = await transaction.gitHubRepositorySource.findUnique({
          where: { id: source.id },
        })
        if (
          !current ||
          current.status !== "active" ||
          current.synchronizationGeneration !== source.synchronizationGeneration
        ) {
          return false
        }
        if (actorSessionToken) {
          await currentAdministrator(store, actorSessionToken, transaction, false)
        }
        await transaction.gitHubRepositorySource.update({
          where: { id: source.id },
          data: {
            owner: repository.owner.login,
            name: repository.name,
            defaultBranch: repository.default_branch,
            visibility: repository.visibility,
            status: "active",
            removedAt: null,
            synchronizationStatus: partialFailure ? "failed" : "current",
            synchronizationError: partialFailure ? "permission_partial_failure" : null,
            dirtyAt: null,
            ...(!partialFailure && confirmedAt ? { lastConfirmedAt: confirmedAt } : {}),
          },
        })
        await enforceSynchronizedMemberships(transaction, confirmedAt ?? new Date())
        await saveSecurityAudit(transaction, {
          event: "github.repository.reconcile",
          actorUserId: actor?.userId ?? null,
          sessionId: actor?.id ?? null,
          authenticationProviderRevisionId: actor?.authenticationProviderRevisionId ?? null,
          githubRepositorySourceId: source.id,
          context: { source: "github_app_installation" },
        })
        return true
      })
      if (!applied) {
        return database.gitHubRepositorySource.findUnique({ where: { id: source.id } })
      }
      return database.gitHubRepositorySource.findUnique({ where: { id: source.id } })
    } catch (error) {
      if (
        error instanceof AuthenticationError &&
        [
          "fresh_authorization_required",
          "installation_administrator_required",
          "membership_inactive",
          "sign_in_required",
        ].includes(error.code)
      ) {
        throw error
      }
      if (error instanceof GitHubApiError && error.status === 404 && phase === "token") {
        await store.lock((_records, transaction) =>
          removeInstallationSources(transaction, installationSnapshots, new Date()),
        )
        return database.gitHubRepositorySource.findUnique({ where: { id: source.id } })
      }
      if (error instanceof GitHubApiError && error.status === 404 && phase === "repository") {
        const removed = await store.lock(async (_records, transaction) => {
          await lockRepository(transaction, source.id)
          const current = await transaction.gitHubRepositorySource.findUnique({
            where: { id: source.id },
          })
          if (
            !current ||
            current.status !== "active" ||
            current.synchronizationGeneration !== source.synchronizationGeneration
          ) {
            return false
          }
          await removeRepositorySource(transaction, source.id, new Date())
          return true
        })
        if (!removed) {
          return database.gitHubRepositorySource.findUnique({ where: { id: source.id } })
        }
        return database.gitHubRepositorySource.findUnique({ where: { id: source.id } })
      }
      const synchronizationError =
        phase === "apply"
          ? "apply_failed"
          : error instanceof GitHubApiError
            ? `github_${error.status}`
            : error instanceof AuthenticationError
              ? error.code
              : ["token", "repository", "permissions"].includes(phase)
                ? "provider_response_invalid"
                : "provider_unavailable"
      let failed
      try {
        failed = await database.gitHubRepositorySource.updateMany({
          where: {
            id: source.id,
            status: "active",
            synchronizationGeneration: source.synchronizationGeneration,
          },
          data: {
            synchronizationStatus: "failed",
            synchronizationError,
          },
        })
      } catch {
        throw error
      }
      if (failed.count === 0) {
        return database.gitHubRepositorySource.findUnique({ where: { id: source.id } })
      }
      if (phase === "apply") throw error
      if (error instanceof AuthenticationError) throw error
      throw new AuthenticationError(
        503,
        "source_integration_unavailable",
        "GitHub source integration is unavailable.",
      )
    }
  }

  return {
    async evaluateAdmission(profile) {
      const sources = await database.gitHubRepositorySource.findMany({
        where: { status: "active", admissionEnabled: true },
        orderBy: { id: "asc" },
      })
      if (sources.length === 0) return null
      const identity = await database.externalIdentity.findUnique({
        where: {
          provider_issuer_subject: {
            provider: "github",
            issuer: "https://github.com",
            subject: profile.subject,
          },
        },
        include: { user: { include: { memberships: true } } },
      })
      const cutoff = new Date(Date.now() - (await lastKnownGoodSeconds(database)) * 1_000)
      const cached = identity
        ? await database.gitHubSynchronizedAccess.findMany({
            where: {
              userId: identity.userId,
              status: "active",
              admissionEligible: true,
              lastConfirmedAt: { gte: cutoff },
              repositorySourceId: { in: sources.map(({ id }) => id) },
            },
          })
        : []
      const cachedBySource = new Map(
        cached.map((baseline) => [baseline.repositorySourceId, baseline]),
      )
      const membership = identity?.user.memberships[0]
      let integration: GitHubCredentials
      try {
        integration = await sourceCredentials()
      } catch (error) {
        if (membership?.status === "active" && membership.source !== "synchronized") {
          return null
        }
        throw error instanceof AuthenticationError
          ? error
          : new AuthenticationError(
              503,
              "source_integration_unavailable",
              "GitHub source integration is unavailable.",
            )
      }
      let token: string
      const installationSnapshots = await database.gitHubRepositorySource.findMany({
        where: {
          appId: integration.appId,
          installationId: integration.installationId,
          status: { in: ["active", "suspended"] },
        },
        select: { id: true, synchronizationGeneration: true },
      })
      try {
        token = await createInstallationToken(integration)
      } catch (error) {
        if (error instanceof GitHubApiError && error.status === 404) {
          await store.lock((_records, transaction) =>
            removeInstallationSources(transaction, installationSnapshots, new Date()),
          )
        } else if (error instanceof GitHubApiError) {
          for (const source of sources) {
            if (
              source.appId !== integration!.appId ||
              source.installationId !== integration!.installationId
            ) {
              continue
            }
            const baseline = cachedBySource.get(source.id)
            if (baseline) {
              const mapped = mapGitHubPermission(
                baseline.rawPermission as GitHubRepositoryPermission,
              )
              return {
                repositorySourceId: source.id,
                sourceGeneration: source.synchronizationGeneration,
                subject: profile.subject,
                admissionGeneration: 0,
                persist: false,
                rawPermission: baseline.rawPermission as GitHubRepositoryPermission,
                ...mapped,
                confirmedAt: baseline.lastConfirmedAt,
              }
            }
          }
        }
        if (membership?.status === "active" && membership.source !== "synchronized") {
          return null
        }
        throw new AuthenticationError(
          503,
          "source_integration_unavailable",
          "GitHub source integration is unavailable.",
        )
      }
      let providerUnavailable = false
      for (const source of sources) {
        if (
          source.appId !== integration.appId ||
          source.installationId !== integration.installationId
        ) {
          continue
        }
        try {
          const claim = await claimAdmissionGeneration(
            source.id,
            profile.subject,
            source.synchronizationGeneration,
            true,
          )
          if (claim.status === "changed") {
            throw new AuthenticationError(
              409,
              "github_authorization_changed",
              "GitHub authorization changed. Start again.",
            )
          }
          if (claim.status === "denied") continue
          let repository: z.infer<typeof repositorySchema>
          try {
            repository = repositorySchema.parse(
              await requestGitHubApi(`/repositories/${source.githubRepositoryId}`, token),
            )
          } catch (error) {
            if (error instanceof GitHubApiError && error.status === 404) {
              await store.lock(async (_records, transaction) => {
                await lockRepository(transaction, source.id)
                const current = await transaction.gitHubRepositorySource.findUnique({
                  where: { id: source.id },
                })
                if (
                  current?.status === "active" &&
                  current.synchronizationGeneration === source.synchronizationGeneration
                ) {
                  await removeRepositorySource(transaction, source.id, new Date())
                }
              })
              continue
            }
            throw error
          }
          const rawPermission = await permissionFor(
            token,
            (await currentUsername(token, profile.subject)) ?? profile.username,
            profile.subject,
            repository.full_name,
            repository.visibility,
          )
          const mapped = mapGitHubPermission(rawPermission)
          if (mapped.admissionEligible) {
            return {
              repositorySourceId: source.id,
              sourceGeneration: claim.source.synchronizationGeneration,
              subject: profile.subject,
              admissionGeneration: claim.admissionGeneration,
              persist: true,
              rawPermission,
              ...mapped,
              confirmedAt: new Date(),
            }
          }
          if (identity) {
            await store.lock((_records, transaction) =>
              saveBaseline(transaction, identity.userId, {
                repositorySourceId: source.id,
                sourceGeneration: claim.source.synchronizationGeneration,
                subject: profile.subject,
                admissionGeneration: claim.admissionGeneration,
                persist: true,
                rawPermission,
                ...mapped,
                confirmedAt: new Date(),
              }),
            )
          }
        } catch (error) {
          if (!(error instanceof GitHubApiError)) throw error
          providerUnavailable = true
          const baseline = cachedBySource.get(source.id)
          if (baseline) {
            const mapped = mapGitHubPermission(baseline.rawPermission as GitHubRepositoryPermission)
            return {
              repositorySourceId: source.id,
              sourceGeneration: source.synchronizationGeneration,
              subject: profile.subject,
              admissionGeneration: 0,
              persist: false,
              rawPermission: baseline.rawPermission as GitHubRepositoryPermission,
              ...mapped,
              confirmedAt: baseline.lastConfirmedAt,
            }
          }
        }
      }
      if (providerUnavailable) {
        if (membership?.status === "active" && membership.source !== "synchronized") {
          return null
        }
        throw new AuthenticationError(
          503,
          "source_integration_unavailable",
          "GitHub source integration is unavailable.",
        )
      }
      return null
    },

    async saveAdmissionBaseline(transaction, userId, baseline) {
      await saveBaseline(transaction, userId, baseline, true)
    },

    async prototypeBaseline(
      transaction,
      userId,
      prototypeId,
      now = new Date(),
    ): Promise<GitHubPrototypeBaseline | null> {
      const prototype = await transaction.prototype.findUnique({
        where: { id: prototypeId },
        select: {
          authorizationMode: true,
          sourceRepositoryId: true,
        },
      })
      if (prototype?.authorizationMode !== "github-synchronized" || !prototype.sourceRepositoryId) {
        return null
      }
      const cutoff = new Date(now.getTime() - (await lastKnownGoodSeconds(transaction)) * 1_000)
      const baseline = await transaction.gitHubSynchronizedAccess.findUnique({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: prototype.sourceRepositoryId,
            userId,
          },
        },
        include: { repositorySource: true },
      })
      if (
        !baseline ||
        baseline.status !== "active" ||
        !baseline.mappedPrototypeRole ||
        baseline.lastConfirmedAt < cutoff ||
        baseline.repositorySource.status !== "active"
      ) {
        return null
      }
      return {
        role: baseline.mappedPrototypeRole,
        repositorySourceId: baseline.repositorySourceId,
        githubRepositoryId: baseline.repositorySource.githubRepositoryId,
        rawPermission: baseline.rawPermission as GitHubRepositoryPermission,
        confirmedAt: baseline.lastConfirmedAt,
        synchronizationStatus: baseline.repositorySource.synchronizationStatus,
      }
    },

    async prototypeWorkspaceIds(transaction, userId, now = new Date()) {
      const cutoff = new Date(now.getTime() - (await lastKnownGoodSeconds(transaction)) * 1_000)
      const prototypes = await transaction.prototype.findMany({
        where: {
          authorizationMode: "github-synchronized",
          sourceRepository: {
            status: "active",
            synchronizedAccess: {
              some: {
                userId,
                status: "active",
                mappedPrototypeRole: { not: null },
                lastConfirmedAt: { gte: cutoff },
              },
            },
          },
        },
        select: { workspaceId: true },
      })
      return [...new Set(prototypes.map(({ workspaceId }) => workspaceId))]
    },

    async prototypeIds(transaction, userId, workspaceId, now = new Date()) {
      const cutoff = new Date(now.getTime() - (await lastKnownGoodSeconds(transaction)) * 1_000)
      const prototypes = await transaction.prototype.findMany({
        where: {
          workspaceId,
          authorizationMode: "github-synchronized",
          grants: { none: { userId, effect: "deny" } },
          sourceRepository: {
            status: "active",
            synchronizedAccess: {
              some: {
                userId,
                status: "active",
                mappedPrototypeRole: { not: null },
                lastConfirmedAt: { gte: cutoff },
              },
            },
          },
        },
        select: { id: true },
      })
      return prototypes.map(({ id }) => id)
    },

    async listRepositories(sessionToken) {
      await currentAdministrator(store, sessionToken, undefined, false)
      return database.gitHubRepositorySource.findMany({ orderBy: { createdAt: "asc" } })
    },

    async linkRepository(sessionToken, input) {
      const parsed = linkSchema.safeParse(input)
      if (!parsed.success) {
        throw new AuthenticationError(
          422,
          "invalid_repository_link",
          "The repository link is invalid.",
        )
      }
      await currentAdministrator(store, sessionToken)
      let integration: GitHubCredentials
      let repository: z.infer<typeof repositorySchema>
      try {
        integration = await sourceCredentials()
        const token = await createInstallationToken(integration)
        repository = repositorySchema.parse(
          await requestGitHubApi(`/repositories/${parsed.data.githubRepositoryId}`, token),
        )
      } catch (error) {
        if (error instanceof GitHubApiError && error.status === 404) {
          throw new AuthenticationError(
            422,
            "repository_source_inaccessible",
            "The GitHub repository is not accessible to this installation.",
          )
        }
        if (error instanceof AuthenticationError) throw error
        throw new AuthenticationError(
          503,
          "source_integration_unavailable",
          "GitHub source integration is unavailable.",
        )
      }
      return store.lock(async (_records, transaction) => {
        const actor = await currentAdministrator(store, sessionToken, transaction)
        const linked = await transaction.gitHubRepositorySource.upsert({
          where: { githubRepositoryId: String(repository.id) },
          create: {
            githubRepositoryId: String(repository.id),
            appId: integration.appId,
            installationId: integration.installationId,
            owner: repository.owner.login,
            name: repository.name,
            defaultBranch: repository.default_branch,
            visibility: repository.visibility,
            admissionEnabled: parsed.data.admissionEnabled ?? false,
            dirtyAt: new Date(),
          },
          update: {
            appId: integration.appId,
            installationId: integration.installationId,
            owner: repository.owner.login,
            name: repository.name,
            defaultBranch: repository.default_branch,
            visibility: repository.visibility,
            status: "active",
            removedAt: null,
            ...(parsed.data.admissionEnabled === undefined
              ? {}
              : { admissionEnabled: parsed.data.admissionEnabled }),
            synchronizationGeneration: { increment: 1 },
            synchronizationStatus: "dirty",
            dirtyAt: new Date(),
          },
        })
        await saveSecurityAudit(transaction, {
          event: "github.repository.link",
          actorUserId: actor.userId,
          sessionId: actor.id,
          authenticationProviderRevisionId: actor.authenticationProviderRevisionId,
          githubRepositorySourceId: linked.id,
          context: { source: "github_app_installation" },
        })
        return linked
      })
    },

    async updateRepository(sessionToken, repositorySourceId, input) {
      const parsed = updateSchema.safeParse(input)
      if (!parsed.success || !identifierSchema.safeParse(repositorySourceId).success) {
        throw new AuthenticationError(
          422,
          "invalid_repository_policy",
          "The repository policy is invalid.",
        )
      }
      return store.lock(async (_records, transaction) => {
        const actor = await currentAdministrator(store, sessionToken, transaction)
        await lockRepository(transaction, repositorySourceId)
        const source = await transaction.gitHubRepositorySource.findUnique({
          where: { id: repositorySourceId },
        })
        if (!source || !["active", "suspended"].includes(source.status)) {
          throw new AuthenticationError(
            404,
            "repository_source_not_found",
            "The repository link was not found.",
          )
        }
        const updated = await transaction.gitHubRepositorySource.update({
          where: { id: source.id },
          data: { admissionEnabled: parsed.data.admissionEnabled },
        })
        await saveSecurityAudit(transaction, {
          event: "github.repository.policy",
          actorUserId: actor.userId,
          sessionId: actor.id,
          authenticationProviderRevisionId: actor.authenticationProviderRevisionId,
          githubRepositorySourceId: source.id,
          context: {
            reason: parsed.data.admissionEnabled ? "admission_enabled" : "admission_disabled",
          },
        })
        return updated
      })
    },

    async unlinkRepository(sessionToken, repositorySourceId) {
      if (!identifierSchema.safeParse(repositorySourceId).success) {
        throw new AuthenticationError(
          404,
          "repository_source_not_found",
          "The repository link was not found.",
        )
      }
      await store.lock(async (_records, transaction) => {
        const actor = await currentAdministrator(store, sessionToken, transaction)
        await lockRepository(transaction, repositorySourceId)
        const removedAt = new Date()
        const source = await transaction.gitHubRepositorySource.findUnique({
          where: { id: repositorySourceId },
        })
        if (!source || !["active", "suspended"].includes(source.status)) {
          throw new AuthenticationError(
            404,
            "repository_source_not_found",
            "The repository link was not found.",
          )
        }
        await removeRepositorySource(transaction, source.id, removedAt)
        await saveSecurityAudit(transaction, {
          event: "github.repository.unlink",
          actorUserId: actor.userId,
          sessionId: actor.id,
          authenticationProviderRevisionId: actor.authenticationProviderRevisionId,
          githubRepositorySourceId: source.id,
          context: { source: "github_app_installation" },
        })
      })
    },

    async reconcileRepository(sessionToken, repositorySourceId) {
      await currentAdministrator(store, sessionToken)
      if (!identifierSchema.safeParse(repositorySourceId).success) {
        throw new AuthenticationError(
          404,
          "repository_source_not_found",
          "The repository link was not found.",
        )
      }
      return reconcile(repositorySourceId, sessionToken)
    },

    async reconcileDue() {
      if (reconciliationDueRunning) return
      reconciliationDueRunning = true
      try {
        const sources = await database.gitHubRepositorySource.findMany({
          where: { status: "active" },
          select: { id: true },
        })
        for (const source of sources) {
          try {
            const reconciled = await reconcile(source.id)
            if (reconciled?.synchronizationStatus === "failed") {
              log("error", "GitHub authorization reconciliation failed", {
                repositorySourceId: source.id,
                reason: reconciled.synchronizationError ?? "reconciliation_failed",
              })
            }
          } catch {
            const failed = await database.gitHubRepositorySource.findUnique({
              where: { id: source.id },
              select: { synchronizationError: true },
            })
            log("error", "GitHub authorization reconciliation failed", {
              repositorySourceId: source.id,
              reason: failed?.synchronizationError ?? "reconciliation_failed",
            })
          }
        }
        await store.lock((_records, transaction) =>
          enforceSynchronizedMemberships(transaction, new Date()),
        )
      } finally {
        reconciliationDueRunning = false
      }
    },

    async processWebhook({ body, deliveryId, event, signature }) {
      if (!webhookSecret) {
        throw new AuthenticationError(
          503,
          "github_webhook_unconfigured",
          "GitHub webhook verification is not configured.",
        )
      }
      const expected = `sha256=${createHmac("sha256", webhookSecret).update(body).digest("hex")}`
      const signatureBuffer = Buffer.from(signature)
      const expectedBuffer = Buffer.from(expected)
      const valid =
        signatureBuffer.length === expectedBuffer.length &&
        timingSafeEqual(signatureBuffer, expectedBuffer)
      if (!valid) {
        throw new AuthenticationError(
          401,
          "invalid_github_webhook",
          "The GitHub webhook is invalid.",
        )
      }
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(deliveryId) || !/^[a-z_]{1,64}$/.test(event)) {
        throw new AuthenticationError(
          422,
          "invalid_github_webhook",
          "The GitHub webhook is invalid.",
        )
      }
      const relevant = new Set([
        "installation",
        "installation_repositories",
        "repository",
        "member",
        "membership",
        "organization",
        "team",
        "team_add",
      ])
      if (!relevant.has(event)) return "ignored"
      let decoded: unknown
      try {
        decoded = JSON.parse(body.toString("utf8"))
      } catch {
        throw new AuthenticationError(
          422,
          "invalid_github_webhook",
          "The GitHub webhook is invalid.",
        )
      }
      const payload = webhookSchema.safeParse(decoded)
      if (!payload.success) {
        throw new AuthenticationError(
          422,
          "invalid_github_webhook",
          "The GitHub webhook is invalid.",
        )
      }
      const installationId = String(payload.data.installation.id)
      try {
        const processed = await store.lock(async (_records, transaction) => {
          const linkedInstallation = await transaction.gitHubRepositorySource.findFirst({
            where: { installationId },
            select: { id: true },
          })
          if (!linkedInstallation) {
            return { result: "ignored" as const, dirtySourceIds: [] }
          }
          const repositoryId = payload.data.repository?.id
          const source = repositoryId
            ? await transaction.gitHubRepositorySource.findFirst({
                where: { githubRepositoryId: String(repositoryId), installationId },
              })
            : null
          await transaction.gitHubWebhookDelivery.create({
            data: {
              deliveryId,
              event,
              action: payload.data.action ?? null,
              installationId,
              repositorySourceId: source?.id ?? null,
            },
          })
          const now = new Date()
          if (event === "installation" && payload.data.action === "deleted") {
            const sources = await transaction.gitHubRepositorySource.findMany({
              where: {
                installationId,
                status: { in: ["active", "suspended"] },
              },
              select: { id: true },
            })
            for (const source of sources) {
              await removeRepositorySource(transaction, source.id, now, false)
            }
            await enforceSynchronizedMemberships(transaction, now)
          } else if (event === "installation" && payload.data.action === "suspend") {
            await suspendInstallationSources(transaction, installationId, now)
          } else if (event === "installation" && payload.data.action === "unsuspend") {
            await resumeInstallationSources(transaction, installationId, now)
          } else {
            const dirtyIds = new Set<string>()
            const removedIds = new Set<string>()
            if (event === "repository" && payload.data.action === "deleted" && repositoryId) {
              removedIds.add(String(repositoryId))
            }
            for (const repository of payload.data.repositories_added ?? [])
              dirtyIds.add(String(repository.id))
            for (const repository of payload.data.repositories_removed ?? [])
              removedIds.add(String(repository.id))
            if (repositoryId) dirtyIds.add(String(repositoryId))
            if (removedIds.size > 0) {
              const removedSources = await transaction.gitHubRepositorySource.findMany({
                where: {
                  githubRepositoryId: { in: [...removedIds] },
                  installationId,
                  status: { in: ["active", "suspended"] },
                },
                select: { id: true },
              })
              for (const source of removedSources) {
                await removeRepositorySource(transaction, source.id, now, false)
              }
              await enforceSynchronizedMemberships(transaction, now)
            }
            if (dirtyIds.size > 0) {
              const invalidatesSourceIdentity =
                event === "repository" || event === "installation_repositories"
              await transaction.gitHubRepositorySource.updateMany({
                where: {
                  githubRepositoryId: { in: [...dirtyIds] },
                  installationId,
                  status: "active",
                },
                data: {
                  ...(invalidatesSourceIdentity
                    ? { synchronizationGeneration: { increment: 1 } }
                    : {}),
                  synchronizationStatus: "dirty",
                  dirtyAt: now,
                },
              })
            } else if (removedIds.size === 0) {
              await transaction.gitHubRepositorySource.updateMany({
                where: { installationId, status: "active" },
                data: {
                  synchronizationStatus: "dirty",
                  dirtyAt: now,
                },
              })
            }
          }
          await saveSecurityAudit(transaction, {
            event: "github.webhook.process",
            actorUserId: null,
            sessionId: null,
            authenticationProviderRevisionId: null,
            githubRepositorySourceId: source?.id ?? null,
            context: { source: "github_webhook" },
          })
          const dirtySources = await transaction.gitHubRepositorySource.findMany({
            where: {
              installationId,
              status: "active",
              synchronizationStatus: "dirty",
            },
            select: { id: true },
          })
          return {
            result: "accepted" as const,
            dirtySourceIds: dirtySources.map(({ id }) => id),
          }
        })
        scheduleDirtyReconciliation(processed.dirtySourceIds)
        return processed.result
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error as { code?: string }).code === "P2002"
        ) {
          return "duplicate"
        }
        throw error
      }
    },
  }
}
