import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { admitAuthenticationProof } from "../../../../../domains/admission/admit-authentication-proof"
import { AdmissionDeniedError } from "../../../../../domains/admission/errors"
import { restoreHubSession } from "../../../../../domains/admission/restore-hub-session"
import { runAdmissionTransaction } from "../../../../../domains/admission/run-admission-transaction"
import { runSessionRestoreTransaction } from "../../../../../domains/admission/run-session-restore-transaction"
import { syncGitHubInstallationRepositories as syncBoundGitHubInstallationRepositories } from "../../../../../domains/admission/sync-github-installation-repositories"
import { createGitHubUserAuthenticationAdapter } from "../../../../../integrations/github/create-user-authentication-adapter"
import { listInstallationRepositories } from "../../../../../integrations/github/list-installation-repositories"
import { prisma } from "../../../../../integrations/prisma"
import { createSecurityAudit } from "../../../../../repositories/security-audits/create-security-audit"
import { withFailingSecurityAudit } from "../../../../../../test/database/with-failing-security-audit"
import type { ConnectedRepositoryEvidence } from "../../../../../repositories/repository-access/types"
import { createGitHubWebhookRouteDependencies } from "."

const githubProvider = { configurationDigest: "a".repeat(64), revision: 1 }

function syncGitHubInstallationRepositories<T extends ConnectedRepositoryEvidence>(
  database: Parameters<typeof syncBoundGitHubInstallationRepositories>[0],
  fetchRepositories: () => Promise<T[]>,
) {
  return syncBoundGitHubInstallationRepositories(database, fetchRepositories, githubProvider)
}

async function createProvider(key: "github" | "entra") {
  const provider = await prisma.authenticationProvider.create({ data: { enabled: false, key } })
  const revision = await prisma.authenticationProviderRevision.create({
    data: {
      configurationDigest:
        key === "github" ? githubProvider.configurationDigest : randomBytes(32).toString("hex"),
      providerId: provider.id,
      revision: 1,
    },
  })
  await prisma.authenticationProvider.update({
    data: { enabled: true, selectedRevisionId: revision.id },
    where: { id: provider.id },
  })
  return revision.id
}

async function createMember(input: {
  administrator?: boolean
  observedAt?: Date
  provider: "github" | "entra"
  providerRevisionId: string
  repositoryIds: string[]
  sessionCount?: number
  subject: string
}) {
  const user = await prisma.user.create({ data: {} })
  const identity = await prisma.externalIdentity.create({
    data: {
      issuer:
        input.provider === "github"
          ? "https://github.com"
          : "https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0",
      provider: input.provider,
      subject: input.subject,
      userId: user.id,
    },
  })
  const membership = await prisma.membership.create({ data: { userId: user.id } })
  const providerAssignment = await prisma.membershipAssignment.create({
    data: {
      externalIdentityId: identity.id,
      membershipId: membership.id,
      providerAssignmentSubject:
        input.provider === "github" ? "github_repository_access" : randomUUID(),
      providerRevisionId: input.providerRevisionId,
      role: "MEMBER",
      source: "AUTHENTICATION_PROVIDER",
    },
  })
  const administratorAssignment = input.administrator
    ? await prisma.membershipAssignment.create({
        data: {
          externalIdentityId: identity.id,
          membershipId: membership.id,
          role: "ADMINISTRATOR",
          source: "HUB_ADMINISTRATOR",
        },
      })
    : null
  if (input.repositoryIds.length) {
    await prisma.repositoryAccessGrant.createMany({
      data: input.repositoryIds.map((repositoryId) => ({
        membershipId: membership.id,
        observedAt: input.observedAt ?? new Date("2020-01-01T00:00:00Z"),
        repositoryId,
      })),
    })
  }
  const sessions: Array<{ digest: string; id: string }> = []
  for (let index = 0; index < (input.sessionCount ?? 1); index += 1) {
    sessions.push(
      await prisma.hubSession.create({
        data: {
          digest: randomBytes(32).toString("hex"),
          expiresAt: new Date("2099-01-01T00:00:00Z"),
          externalIdentityId: identity.id,
          membershipId: membership.id,
          providerRevisionId: input.providerRevisionId,
          revocationRevision: 0,
        },
        select: { digest: true, id: true },
      }),
    )
  }
  return {
    administratorAssignmentId: administratorAssignment?.id,
    externalIdentityId: identity.id,
    membershipId: membership.id,
    providerAssignmentId: providerAssignment.id,
    sessions,
    userId: user.id,
  }
}

async function createRepository(githubRepositoryId: number | null, name: string) {
  return prisma.repository.create({
    data: {
      defaultBranch: "main",
      githubRepositoryId: githubRepositoryId === null ? null : BigInt(githubRepositoryId),
      nameWithOwner: `team/${name}`,
    },
  })
}

function installationRepository(repository: {
  defaultBranch: string
  githubRepositoryId: bigint | null
  nameWithOwner: string
}) {
  if (repository.githubRepositoryId === null) throw new Error("Missing GitHub repository ID.")
  return {
    defaultBranch: repository.defaultBranch,
    githubRepositoryId: Number(repository.githubRepositoryId),
    nameWithOwner: repository.nameWithOwner,
  }
}

async function createHistory(repositoryId: string) {
  const prototype = await prisma.prototype.create({
    data: {
      branchName: "prototype/history",
      name: "History",
      registeredAt: new Date("2026-01-01T00:00:00Z"),
      repositoryId,
    },
  })
  const build = await prisma.build.create({
    data: { number: 1, prototypeId: prototype.id, state: "successful" },
  })
  await prisma.prototype.update({
    data: { currentBuildId: build.id },
    where: { id: prototype.id },
  })
  return { buildId: build.id, prototypeId: prototype.id }
}

function webhook() {
  return createGitHubWebhookRouteDependencies({
    installationId: "700",
    provider: githubProvider,
    syncRepositories: () => {
      throw new Error("Removal events must not sync repositories.")
    },
    webhookSecret: "webhook-secret-for-tests",
  })
}

async function repositoryGrants(membershipId: string) {
  const grants = await prisma.repositoryAccessGrant.findMany({
    orderBy: { repositoryId: "asc" },
    select: { repositoryId: true },
    where: { membershipId },
  })
  return grants.map(({ repositoryId }) => repositoryId)
}

function restore(digest: string) {
  return restoreHubSession(digest, {
    runTransaction: (operation) => runSessionRestoreTransaction(prisma, operation),
  })
}

describe("createGitHubWebhookRouteDependencies()", () => {
  it("removes only the collaborator's grant while another connected grant keeps the session usable", async () => {
    const revisionId = await createProvider("github")
    const removed = await createRepository(1001, "removed-access")
    const retained = await createRepository(1002, "retained-access")
    const affected = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [removed.id, retained.id],
      subject: "101",
    })
    const other = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [removed.id],
      subject: "102",
    })

    await expect(
      webhook().handleEvent("member", {
        action: "removed",
        installation: { id: 700 },
        member: { id: 101 },
        repository: { id: 1001 },
      }),
    ).resolves.toBe(true)

    expect(await repositoryGrants(affected.membershipId)).toEqual([retained.id])
    expect(await repositoryGrants(other.membershipId)).toEqual([removed.id])
    await expect(
      prisma.membershipAssignment.findUniqueOrThrow({
        select: { lifecycle: true },
        where: { id: affected.providerAssignmentId },
      }),
    ).resolves.toEqual({ lifecycle: "ACTIVE" })
    await expect(restore(affected.sessions[0]!.digest)).resolves.toMatchObject({
      membershipId: affected.membershipId,
      role: "MEMBER",
    })
    await expect(restore(other.sessions[0]!.digest)).resolves.toMatchObject({
      membershipId: other.membershipId,
      role: "MEMBER",
    })
    expect(
      await prisma.securityAudit.count({
        where: { action: { in: ["provider.membership.assignment.revoked", "session.ended"] } },
      }),
    ).toBe(0)
  })

  it.each([
    { event: "member", name: "the last collaborator grant" },
    { event: "organization", name: "organization membership" },
  ])(
    "revokes provider authority and sessions after losing $name without revoking administrator authority",
    async ({ event }) => {
      const revisionId = await createProvider("github")
      const first = await createRepository(1001, "first")
      const second = await createRepository(1002, "second")
      const affected = await createMember({
        administrator: true,
        provider: "github",
        providerRevisionId: revisionId,
        repositoryIds: event === "member" ? [first.id] : [first.id, second.id],
        sessionCount: 2,
        subject: "101",
      })
      const other = await createMember({
        provider: "github",
        providerRevisionId: revisionId,
        repositoryIds: [first.id, second.id],
        subject: "102",
      })
      const payload =
        event === "member"
          ? {
              action: "removed",
              installation: { id: 700 },
              member: { id: 101 },
              repository: { id: 1001 },
            }
          : {
              action: "member_removed",
              installation: { id: 700 },
              membership: { user: { id: 101 } },
            }

      await expect(webhook().handleEvent(event, payload)).resolves.toBe(true)

      expect(await repositoryGrants(affected.membershipId)).toEqual([])
      expect(await repositoryGrants(other.membershipId)).toEqual([first.id, second.id].sort())
      await expect(
        prisma.membershipAssignment.findUniqueOrThrow({
          select: { lifecycle: true },
          where: { id: affected.providerAssignmentId },
        }),
      ).resolves.toEqual({ lifecycle: "REVOKED" })
      await expect(
        prisma.membershipAssignment.findUniqueOrThrow({
          select: { lifecycle: true, role: true, source: true },
          where: { id: affected.administratorAssignmentId! },
        }),
      ).resolves.toEqual({
        lifecycle: "ACTIVE",
        role: "ADMINISTRATOR",
        source: "HUB_ADMINISTRATOR",
      })
      await expect(
        prisma.membership.findUniqueOrThrow({
          select: { lifecycle: true },
          where: { id: affected.membershipId },
        }),
      ).resolves.toEqual({ lifecycle: "ACTIVE" })
      for (const session of affected.sessions) {
        await expect(
          prisma.hubSession.findUniqueOrThrow({
            select: { endedAt: true },
            where: { id: session.id },
          }),
        ).resolves.toHaveProperty("endedAt", expect.any(Date))
        await expect(restore(session.digest)).resolves.toBeNull()
      }
      await expect(restore(other.sessions[0]!.digest)).resolves.toMatchObject({
        membershipId: other.membershipId,
        role: "MEMBER",
      })
      const audits = await prisma.securityAudit.findMany({
        select: { action: true, context: true, outcome: true, targetId: true },
        where: { action: { in: ["provider.membership.assignment.revoked", "session.ended"] } },
      })
      expect(audits).toHaveLength(3)
      expect(
        audits.find((audit) => audit.action === "provider.membership.assignment.revoked"),
      ).toMatchObject({
        context: { membershipId: affected.membershipId },
        outcome: "SUCCESS",
        targetId: affected.providerAssignmentId,
      })
      for (const session of affected.sessions) {
        expect(audits).toContainEqual({
          action: "session.ended",
          context: { membershipId: affected.membershipId },
          outcome: "SUCCESS",
          targetId: session.id,
        })
      }

      const newSession = await prisma.hubSession.create({
        data: {
          digest: randomBytes(32).toString("hex"),
          expiresAt: new Date("2099-01-01T00:00:00Z"),
          externalIdentityId: affected.externalIdentityId,
          membershipId: affected.membershipId,
          providerRevisionId: revisionId,
          revocationRevision: 0,
        },
      })
      await expect(restore(newSession.digest)).resolves.toMatchObject({
        membershipId: affected.membershipId,
        role: "ADMINISTRATOR",
      })
    },
  )

  it("disconnects removed installation repositories without deleting history or revoking users with other access", async () => {
    const revisionId = await createProvider("github")
    const removed = await createRepository(1001, "removed")
    const retained = await createRepository(1002, "retained")
    const history = await createHistory(removed.id)
    const affected = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [removed.id],
      subject: "101",
    })
    const partiallyAffected = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [removed.id, retained.id],
      subject: "102",
    })
    const unaffected = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [retained.id],
      subject: "103",
    })

    await expect(
      webhook().handleEvent("installation_repositories", {
        action: "removed",
        installation: { id: 700 },
        repositories_removed: [{ id: 1001 }],
      }),
    ).resolves.toBe(true)

    const disconnected = await prisma.repository.findUniqueOrThrow({
      include: { prototypes: { include: { builds: true } } },
      where: { id: removed.id },
    })
    expect(disconnected.removedAt).toBeInstanceOf(Date)
    expect(disconnected).toMatchObject({
      id: removed.id,
      prototypes: [
        {
          id: history.prototypeId,
          currentBuildId: history.buildId,
          builds: [{ id: history.buildId, prototypeId: history.prototypeId }],
        },
      ],
    })
    await expect(
      prisma.repository.findUniqueOrThrow({
        select: { removedAt: true },
        where: { id: retained.id },
      }),
    ).resolves.toEqual({ removedAt: null })
    expect(await repositoryGrants(affected.membershipId)).toEqual([])
    expect(await repositoryGrants(partiallyAffected.membershipId)).toEqual([retained.id])
    expect(await repositoryGrants(unaffected.membershipId)).toEqual([retained.id])
    await expect(
      prisma.membershipAssignment.findUniqueOrThrow({
        select: { lifecycle: true },
        where: { id: affected.providerAssignmentId },
      }),
    ).resolves.toEqual({ lifecycle: "REVOKED" })
    await expect(restore(affected.sessions[0]!.digest)).resolves.toBeNull()
    for (const member of [partiallyAffected, unaffected]) {
      await expect(
        prisma.membershipAssignment.findUniqueOrThrow({
          select: { lifecycle: true },
          where: { id: member.providerAssignmentId },
        }),
      ).resolves.toEqual({ lifecycle: "ACTIVE" })
      await expect(restore(member.sessions[0]!.digest)).resolves.toMatchObject({
        membershipId: member.membershipId,
        role: "MEMBER",
      })
    }
    const audits = await prisma.securityAudit.findMany({
      select: { action: true, targetId: true },
      where: { action: { in: ["provider.membership.assignment.revoked", "session.ended"] } },
    })
    expect(audits).toEqual(
      expect.arrayContaining([
        {
          action: "provider.membership.assignment.revoked",
          targetId: affected.providerAssignmentId,
        },
        { action: "session.ended", targetId: affected.sessions[0]!.id },
      ]),
    )
    expect(audits).toHaveLength(2)
  })

  it.each(["suspend", "deleted"] as const)(
    "disconnects installation repositories and revokes GitHub access after installation %s",
    async (action) => {
      const githubRevisionId = await createProvider("github")
      const entraRevisionId = await createProvider("entra")
      const first = await createRepository(1001, "first")
      const second = await createRepository(1002, "second")
      const unrelated = await createRepository(null, "unrelated")
      const history = await createHistory(first.id)
      const firstMember = await createMember({
        provider: "github",
        providerRevisionId: githubRevisionId,
        repositoryIds: [first.id],
        subject: "101",
      })
      const secondMember = await createMember({
        provider: "github",
        providerRevisionId: githubRevisionId,
        repositoryIds: [first.id, second.id],
        subject: "102",
      })
      const entraMember = await createMember({
        provider: "entra",
        providerRevisionId: entraRevisionId,
        repositoryIds: [],
        subject: "entra-subject",
      })

      await expect(
        webhook().handleEvent("installation", { action, installation: { id: 700 } }),
      ).resolves.toBe(true)

      const disconnected = await prisma.repository.findUniqueOrThrow({
        include: { prototypes: { include: { builds: true } } },
        where: { id: first.id },
      })
      expect(disconnected.removedAt).toBeInstanceOf(Date)
      expect(disconnected).toMatchObject({
        prototypes: [
          {
            id: history.prototypeId,
            currentBuildId: history.buildId,
            builds: [{ id: history.buildId, prototypeId: history.prototypeId }],
          },
        ],
      })
      await expect(
        prisma.repository.findUniqueOrThrow({
          select: { removedAt: true },
          where: { id: second.id },
        }),
      ).resolves.toHaveProperty("removedAt", expect.any(Date))
      await expect(
        prisma.repository.findUniqueOrThrow({
          select: { removedAt: true },
          where: { id: unrelated.id },
        }),
      ).resolves.toEqual({ removedAt: null })
      for (const member of [firstMember, secondMember]) {
        expect(await repositoryGrants(member.membershipId)).toEqual([])
        await expect(
          prisma.membershipAssignment.findUniqueOrThrow({
            select: { lifecycle: true },
            where: { id: member.providerAssignmentId },
          }),
        ).resolves.toEqual({ lifecycle: "REVOKED" })
        await expect(
          prisma.hubSession.findUniqueOrThrow({
            select: { endedAt: true },
            where: { id: member.sessions[0]!.id },
          }),
        ).resolves.toHaveProperty("endedAt", expect.any(Date))
        await expect(restore(member.sessions[0]!.digest)).resolves.toBeNull()
      }
      await expect(restore(entraMember.sessions[0]!.digest)).resolves.toMatchObject({
        membershipId: entraMember.membershipId,
        role: "MEMBER",
      })
      const audits = await prisma.securityAudit.findMany({
        select: { action: true, targetId: true },
        where: { action: { in: ["provider.membership.assignment.revoked", "session.ended"] } },
      })
      expect(audits).toEqual(
        expect.arrayContaining(
          [firstMember, secondMember].flatMap((member) => [
            {
              action: "provider.membership.assignment.revoked",
              targetId: member.providerAssignmentId,
            },
            { action: "session.ended", targetId: member.sessions[0]!.id },
          ]),
        ),
      )
      expect(audits).toHaveLength(4)
    },
  )

  it.each([
    {
      event: "member",
      name: "collaborator removal",
      payload: {
        action: "removed",
        installation: { id: 700 },
        member: { id: 101 },
        repository: { id: 1001 },
      },
    },
    {
      event: "installation_repositories",
      name: "repository removal",
      payload: {
        action: "removed",
        installation: { id: 700 },
        repositories_removed: [{ id: 1001 }],
      },
    },
    {
      event: "installation",
      name: "installation suspension",
      payload: { action: "suspend", installation: { id: 700 } },
    },
  ])("rolls back $name and its session changes when an audit fails", async ({ event, payload }) => {
    const revisionId = await createProvider("github")
    const first = await createRepository(1001, "first")
    const second = await createRepository(1002, "second")
    const affected = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [first.id],
      subject: "101",
    })
    const other = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [second.id],
      subject: "102",
    })

    await withFailingSecurityAudit("session.ended", () =>
      expect(webhook().handleEvent(event, payload)).rejects.toThrow(),
    )

    for (const repository of [first, second]) {
      await expect(
        prisma.repository.findUniqueOrThrow({
          select: { removedAt: true },
          where: { id: repository.id },
        }),
      ).resolves.toEqual({ removedAt: null })
    }
    for (const [member, repository] of [
      [affected, first],
      [other, second],
    ] as const) {
      expect(await repositoryGrants(member.membershipId)).toEqual([repository.id])
      await expect(
        prisma.membershipAssignment.findUniqueOrThrow({
          select: { lifecycle: true },
          where: { id: member.providerAssignmentId },
        }),
      ).resolves.toEqual({ lifecycle: "ACTIVE" })
      await expect(
        prisma.hubSession.findUniqueOrThrow({
          select: { endedAt: true },
          where: { id: member.sessions[0]!.id },
        }),
      ).resolves.toEqual({ endedAt: null })
      await expect(restore(member.sessions[0]!.digest)).resolves.toMatchObject({
        membershipId: member.membershipId,
        role: "MEMBER",
      })
    }
    expect(
      await prisma.securityAudit.count({
        where: { action: { in: ["provider.membership.assignment.revoked", "session.ended"] } },
      }),
    ).toBe(0)
  })

  it.each([
    { disconnect: false, name: "the final collaborator grant", retainAnother: false },
    { disconnect: false, name: "one of two collaborator grants", retainAnother: true },
    { disconnect: true, name: "an installation repository", retainAnother: false },
  ])(
    "does not regrant $name from an older in-flight GitHub access snapshot",
    async ({ disconnect, retainAnother }) => {
      const revisionId = await createProvider("github")
      const removed = await createRepository(1001, "removed")
      const retained = await createRepository(1002, "retained")
      const observedAt = new Date(Date.now() - 60_000)
      const previousObservation = new Date(observedAt.getTime() - 60_000)
      const member = await createMember({
        observedAt: previousObservation,
        provider: "github",
        providerRevisionId: revisionId,
        repositoryIds: retainAnother ? [removed.id, retained.id] : [removed.id],
        subject: "101",
      })
      await prisma.providerEvidenceState.create({
        data: {
          externalIdentityId: member.externalIdentityId,
          lastIssuedAt: previousObservation,
          lastRole: "MEMBER",
        },
      })
      const attempt = await prisma.authorizationAttempt.create({
        data: {
          browserBindingDigest: randomBytes(32).toString("hex"),
          codeVerifierCiphertext: "encrypted-verifier",
          consumedAt: observedAt,
          createdAt: new Date(observedAt.getTime() - 1_000),
          expiresAt: new Date("2099-01-01T00:00:00Z"),
          nonceCiphertext: "encrypted-nonce",
          providerRevisionId: revisionId,
          purpose: "SIGN_IN",
          sessionRevocationRevision: 0,
          stateDigest: randomBytes(32).toString("hex"),
          updatedAt: observedAt,
        },
      })
      const staleRepositories = (retainAnother ? [removed, retained] : [removed]).map(
        (repository) => ({
          defaultBranch: repository.defaultBranch,
          githubRepositoryId: Number(repository.githubRepositoryId),
          nameWithOwner: repository.nameWithOwner,
        }),
      )

      await expect(
        disconnect
          ? webhook().handleEvent("installation_repositories", {
              action: "removed",
              installation: { id: 700 },
              repositories_removed: [{ id: 1001 }],
            })
          : webhook().handleEvent("member", {
              action: "removed",
              installation: { id: 700 },
              member: { id: 101 },
              repository: { id: 1001 },
            }),
      ).resolves.toBe(true)
      const newSessionId = randomUUID()
      await expect(
        admitAuthenticationProof(
          {
            proof: {
              authorizationAttemptId: attempt.id,
              externalIdentityId: member.externalIdentityId,
            },
            providerAssignment: {
              assignmentSubject: "github_repository_access",
              issuedAt: observedAt,
              providerRevisionId: revisionId,
              role: "MEMBER",
            },
            providerKey: "github",
            repositoryAccess: staleRepositories,
            requiresProviderAssignmentEvidence: true,
            sessionDigest: randomBytes(32).toString("hex"),
            sessionId: newSessionId,
            sessionLifetimeSeconds: 3_600,
          },
          {
            createId: randomUUID,
            getBootstrapSecretDigest: () => "f".repeat(64),
            runTransaction: (operation) => runAdmissionTransaction(prisma, operation),
            writeAudit: (event) => createSecurityAudit(prisma, event),
          },
        ),
      ).rejects.toBeInstanceOf(AdmissionDeniedError)

      expect(await repositoryGrants(member.membershipId)).toEqual(
        retainAnother ? [retained.id] : [],
      )
      await expect(
        prisma.membershipAssignment.findUniqueOrThrow({
          select: { lifecycle: true },
          where: { id: member.providerAssignmentId },
        }),
      ).resolves.toEqual({ lifecycle: retainAnother ? "ACTIVE" : "REVOKED" })
      await expect(
        prisma.hubSession.findUnique({ where: { id: newSessionId } }),
      ).resolves.toBeNull()
      await expect(
        prisma.repository.findUniqueOrThrow({
          select: { removedAt: true },
          where: { id: removed.id },
        }),
      ).resolves.toHaveProperty("removedAt", disconnect ? expect.any(Date) : null)
      if (retainAnother) {
        await expect(restore(member.sessions[0]!.digest)).resolves.toMatchObject({
          membershipId: member.membershipId,
          role: "MEMBER",
        })
      } else {
        await expect(restore(member.sessions[0]!.digest)).resolves.toBeNull()
      }
    },
  )
})

describe("GitHub repository access", () => {
  it("does not persist the GitHub user token when recording repository access and a session", async () => {
    const revisionId = await createProvider("github")
    const repository = await createRepository(1001, "accessible")
    const member = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [],
      subject: "101",
    })
    const userToken = "github-user-token-for-test"
    const clientSecret = "github-client-secret-for-test"
    const authorizationCode = "authorization-code-for-test"
    const callbackUri = "https://hub.example.test/api/auth/github/callback"
    const request = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: userToken, token_type: "bearer" }))
      .mockResolvedValueOnce(Response.json({ id: 101, login: "octocat" }))
      .mockResolvedValueOnce(
        Response.json({
          total_count: 1,
          repositories: [
            {
              default_branch: repository.defaultBranch,
              full_name: repository.nameWithOwner,
              id: 1001,
            },
          ],
        }),
      )
    const adapter = createGitHubUserAuthenticationAdapter({
      clientSecret,
      fetch: request,
      installationId: 700,
      publicConfiguration: {
        authorizationEndpoint: "https://github.com/login/oauth/authorize",
        callbackUri,
        clientId: "client-id",
        tokenEndpoint: "https://github.com/login/oauth/access_token",
        userEndpoint: "https://api.github.com/user",
      },
    })
    const evidence = await adapter.completeAuthenticationProof({
      callbackUri,
      code: authorizationCode,
      codeVerifier: "verifier-for-test",
      nonce: "unused-by-github",
    })
    if (!evidence.providerAssignment) throw new Error("Missing GitHub assignment evidence.")
    const observedAt = new Date()
    const attempt = await prisma.authorizationAttempt.create({
      data: {
        browserBindingDigest: randomBytes(32).toString("hex"),
        codeVerifierCiphertext: "encrypted-verifier",
        consumedAt: observedAt,
        createdAt: new Date(observedAt.getTime() - 1_000),
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        nonceCiphertext: "encrypted-nonce",
        providerRevisionId: revisionId,
        purpose: "SIGN_IN",
        sessionRevocationRevision: 0,
        stateDigest: randomBytes(32).toString("hex"),
        updatedAt: observedAt,
      },
    })
    const sessionDigest = randomBytes(32).toString("hex")

    await expect(
      admitAuthenticationProof(
        {
          proof: {
            authorizationAttemptId: attempt.id,
            externalIdentityId: member.externalIdentityId,
          },
          providerAssignment: { ...evidence.providerAssignment, providerRevisionId: revisionId },
          providerKey: "github",
          repositoryAccess: evidence.repositoryAccess,
          requiresProviderAssignmentEvidence: true,
          sessionDigest,
          sessionId: randomUUID(),
          sessionLifetimeSeconds: 3_600,
        },
        {
          createId: randomUUID,
          getBootstrapSecretDigest: () => "f".repeat(64),
          runTransaction: (operation) => runAdmissionTransaction(prisma, operation),
          writeAudit: (event) => createSecurityAudit(prisma, event),
        },
      ),
    ).resolves.toMatchObject({ role: "MEMBER" })

    expect(request.mock.calls[2]?.[1]).toMatchObject({
      headers: { authorization: `Bearer ${userToken}` },
    })
    expect(await repositoryGrants(member.membershipId)).toEqual([repository.id])
    await expect(restore(sessionDigest)).resolves.toMatchObject({
      membershipId: member.membershipId,
      role: "MEMBER",
    })
    const stored = JSON.stringify(
      await Promise.all([
        prisma.authenticationProvider.findMany(),
        prisma.authenticationProviderRevision.findMany(),
        prisma.authorizationAttempt.findMany(),
        prisma.externalIdentity.findMany(),
        prisma.user.findMany(),
        prisma.userProfile.findMany(),
        prisma.membership.findMany(),
        prisma.membershipAssignment.findMany(),
        prisma.providerEvidenceState.findMany(),
        prisma.repository.findMany(),
        prisma.repositoryAccessGrant.findMany(),
        prisma.hubSession.findMany(),
        prisma.securityAudit.findMany(),
      ]),
      (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
    )
    expect(stored).not.toContain(userToken)
    expect(stored).not.toContain(clientSecret)
    expect(stored).not.toContain(authorizationCode)
  })
})

describe("syncGitHubInstallationRepositories()", () => {
  it("rejects old installation snapshots and webhooks after the selected provider changes", async () => {
    const revisionId = await createProvider("github")
    const repository = await createRepository(1001, "retained")
    const member = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [repository.id],
      subject: "101",
    })
    const provider = await prisma.authenticationProvider.findUniqueOrThrow({
      where: { key: "github" },
    })
    const replacement = await prisma.authenticationProviderRevision.create({
      data: {
        configurationDigest: "b".repeat(64),
        providerId: provider.id,
        revision: 2,
      },
    })

    await expect(
      syncGitHubInstallationRepositories(prisma, async () => {
        await prisma.authenticationProvider.update({
          data: { selectedRevisionId: replacement.id },
          where: { id: provider.id },
        })
        return []
      }),
    ).rejects.toThrow("not the selected authentication configuration")
    await expect(
      webhook().handleEvent("installation", {
        action: "deleted",
        installation: { id: 700 },
      }),
    ).rejects.toThrow("not the selected authentication configuration")

    await expect(
      prisma.repository.findUniqueOrThrow({
        select: { removedAt: true },
        where: { id: repository.id },
      }),
    ).resolves.toEqual({ removedAt: null })
    expect(await repositoryGrants(member.membershipId)).toEqual([repository.id])
    await expect(
      prisma.hubSession.findUniqueOrThrow({
        select: { endedAt: true },
        where: { id: member.sessions[0]!.id },
      }),
    ).resolves.toEqual({ endedAt: null })
    await expect(
      prisma.membershipAssignment.findUniqueOrThrow({
        select: { lifecycle: true },
        where: { id: member.providerAssignmentId },
      }),
    ).resolves.toEqual({ lifecycle: "ACTIVE" })
  })

  it("disconnects missing repositories without losing history or independent administrator authority", async () => {
    const revisionId = await createProvider("github")
    const removed = await createRepository(1001, "removed")
    const retained = await createRepository(1002, "retained")
    const history = await createHistory(removed.id)
    const administrator = await createMember({
      administrator: true,
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [removed.id],
      sessionCount: 2,
      subject: "101",
    })
    const member = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [removed.id, retained.id],
      subject: "102",
    })
    const snapshot = [installationRepository(retained)]

    await expect(
      syncGitHubInstallationRepositories(prisma, () => Promise.resolve(snapshot)),
    ).resolves.toEqual(snapshot)

    const disconnected = await prisma.repository.findUniqueOrThrow({
      include: { prototypes: { include: { builds: true } } },
      where: { id: removed.id },
    })
    expect(disconnected.removedAt).toBeInstanceOf(Date)
    expect(disconnected).toMatchObject({
      prototypes: [
        {
          id: history.prototypeId,
          currentBuildId: history.buildId,
          builds: [{ id: history.buildId, prototypeId: history.prototypeId }],
        },
      ],
    })
    await expect(
      prisma.repository.findUniqueOrThrow({
        select: { removedAt: true },
        where: { id: retained.id },
      }),
    ).resolves.toEqual({ removedAt: null })
    expect(await repositoryGrants(administrator.membershipId)).toEqual([])
    expect(await repositoryGrants(member.membershipId)).toEqual([retained.id])
    await expect(
      prisma.membershipAssignment.findUniqueOrThrow({
        select: { lifecycle: true },
        where: { id: administrator.providerAssignmentId },
      }),
    ).resolves.toEqual({ lifecycle: "REVOKED" })
    await expect(
      prisma.membershipAssignment.findUniqueOrThrow({
        select: { lifecycle: true, role: true, source: true },
        where: { id: administrator.administratorAssignmentId! },
      }),
    ).resolves.toEqual({
      lifecycle: "ACTIVE",
      role: "ADMINISTRATOR",
      source: "HUB_ADMINISTRATOR",
    })
    for (const session of administrator.sessions) {
      await expect(restore(session.digest)).resolves.toBeNull()
      await expect(
        prisma.hubSession.findUniqueOrThrow({
          select: { endedAt: true },
          where: { id: session.id },
        }),
      ).resolves.toHaveProperty("endedAt", expect.any(Date))
    }
    await expect(restore(member.sessions[0]!.digest)).resolves.toMatchObject({
      membershipId: member.membershipId,
      role: "MEMBER",
    })
    const newAdministratorSession = await prisma.hubSession.create({
      data: {
        digest: randomBytes(32).toString("hex"),
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        externalIdentityId: administrator.externalIdentityId,
        membershipId: administrator.membershipId,
        providerRevisionId: revisionId,
        revocationRevision: 0,
      },
    })
    await expect(restore(newAdministratorSession.digest)).resolves.toMatchObject({
      membershipId: administrator.membershipId,
      role: "ADMINISTRATOR",
    })
    const audits = await prisma.securityAudit.findMany({
      select: { action: true, targetId: true },
      where: { action: { in: ["provider.membership.assignment.revoked", "session.ended"] } },
    })
    expect(audits).toHaveLength(3)
    expect(audits).toEqual(
      expect.arrayContaining([
        {
          action: "provider.membership.assignment.revoked",
          targetId: administrator.providerAssignmentId,
        },
        ...administrator.sessions.map((session) => ({
          action: "session.ended",
          targetId: session.id,
        })),
      ]),
    )
  })

  it("refetches instead of reconnecting a repository removed by a newer webhook", async () => {
    const revisionId = await createProvider("github")
    const removed = await createRepository(1001, "removed")
    const retained = await createRepository(1002, "retained")
    const member = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [removed.id],
      subject: "101",
    })
    const staleSnapshot = [
      installationRepository(removed),
      installationRepository(retained),
      { defaultBranch: "main", githubRepositoryId: 1003, nameWithOwner: "team/stale-only" },
    ]
    const freshSnapshot = [installationRepository(retained)]
    const fetchRepositories = vi
      .fn<() => Promise<typeof freshSnapshot>>()
      .mockImplementationOnce(async () => {
        await expect(
          webhook().handleEvent("installation_repositories", {
            action: "removed",
            installation: { id: 700 },
            repositories_removed: [{ id: 1001 }],
          }),
        ).resolves.toBe(true)
        return staleSnapshot
      })
      .mockImplementationOnce(async () => {
        await expect(
          prisma.repository.findUniqueOrThrow({
            select: { removedAt: true },
            where: { id: removed.id },
          }),
        ).resolves.toHaveProperty("removedAt", expect.any(Date))
        expect(await repositoryGrants(member.membershipId)).toEqual([])
        return freshSnapshot
      })

    await expect(syncGitHubInstallationRepositories(prisma, fetchRepositories)).resolves.toEqual(
      freshSnapshot,
    )

    expect(fetchRepositories).toHaveBeenCalledTimes(2)
    await expect(
      prisma.repository.findUniqueOrThrow({
        select: { removedAt: true },
        where: { id: removed.id },
      }),
    ).resolves.toHaveProperty("removedAt", expect.any(Date))
    await expect(
      prisma.repository.findUnique({ where: { githubRepositoryId: 1003n } }),
    ).resolves.toBeNull()
    expect(await repositoryGrants(member.membershipId)).toEqual([])
    await expect(restore(member.sessions[0]!.digest)).resolves.toBeNull()
  })

  it.each(["request failure", "later-page 404", "short page", "changing total"] as const)(
    "keeps the existing snapshot and access when the installation listing has a %s",
    async (problem) => {
      const revisionId = await createProvider("github")
      const retained = await createRepository(1001, "retained")
      const member = await createMember({
        provider: "github",
        providerRevisionId: revisionId,
        repositoryIds: [retained.id],
        subject: "101",
      })
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
      const page = Array.from({ length: 100 }, (_, index) => ({
        id: 2000 + index,
        full_name: `team/incoming-${index}`,
        default_branch: "main",
      }))
      const request = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(Response.json({ token: "installation-token" }))
        .mockResolvedValueOnce(
          Response.json({
            total_count: 101,
            repositories: problem === "short page" ? page.slice(0, 99) : page,
          }),
        )
      if (problem === "request failure") {
        request.mockRejectedValueOnce(new Error("network unavailable"))
      } else if (problem === "later-page 404") {
        request.mockResolvedValueOnce(new Response(null, { status: 404 }))
      } else if (problem === "changing total") {
        request.mockResolvedValueOnce(
          Response.json({
            total_count: 102,
            repositories: [{ id: 2100, full_name: "team/last", default_branch: "main" }],
          }),
        )
      }

      await expect(
        syncGitHubInstallationRepositories(prisma, () =>
          listInstallationRepositories(
            { appId: "12", installationId: "700", privateKey },
            { fetch: request },
          ),
        ),
      ).rejects.toThrow()

      expect(request).toHaveBeenCalledTimes(problem === "short page" ? 2 : 3)
      await expect(
        prisma.repository.findMany({ select: { githubRepositoryId: true, removedAt: true } }),
      ).resolves.toEqual([{ githubRepositoryId: 1001n, removedAt: null }])
      expect(await repositoryGrants(member.membershipId)).toEqual([retained.id])
      await expect(
        prisma.membershipAssignment.findUniqueOrThrow({
          select: { lifecycle: true },
          where: { id: member.providerAssignmentId },
        }),
      ).resolves.toEqual({ lifecycle: "ACTIVE" })
      await expect(restore(member.sessions[0]!.digest)).resolves.toMatchObject({
        membershipId: member.membershipId,
        role: "MEMBER",
      })
      expect(await prisma.securityAudit.count()).toBe(0)
    },
  )

  it("rolls back the entire snapshot and access changes when a security audit fails", async () => {
    const revisionId = await createProvider("github")
    const existing = await createRepository(1001, "existing")
    const member = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [existing.id],
      subject: "101",
    })
    const snapshot = [
      { defaultBranch: "main", githubRepositoryId: 1002, nameWithOwner: "team/incoming" },
    ]

    await withFailingSecurityAudit("session.ended", () =>
      expect(
        syncGitHubInstallationRepositories(prisma, () => Promise.resolve(snapshot)),
      ).rejects.toThrow(),
    )

    await expect(
      prisma.repository.findMany({ select: { githubRepositoryId: true, removedAt: true } }),
    ).resolves.toEqual([{ githubRepositoryId: 1001n, removedAt: null }])
    expect(await repositoryGrants(member.membershipId)).toEqual([existing.id])
    await expect(
      prisma.membershipAssignment.findUniqueOrThrow({
        select: { lifecycle: true },
        where: { id: member.providerAssignmentId },
      }),
    ).resolves.toEqual({ lifecycle: "ACTIVE" })
    await expect(
      prisma.hubSession.findUniqueOrThrow({
        select: { endedAt: true },
        where: { id: member.sessions[0]!.id },
      }),
    ).resolves.toEqual({ endedAt: null })
    await expect(restore(member.sessions[0]!.digest)).resolves.toMatchObject({
      membershipId: member.membershipId,
      role: "MEMBER",
    })
    expect(await prisma.securityAudit.count()).toBe(0)
  })

  it("reconnects only after a fresh installation snapshot without restoring old grants", async () => {
    const revisionId = await createProvider("github")
    const repository = await createRepository(1001, "reconnected")
    const history = await createHistory(repository.id)
    const member = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [repository.id],
      subject: "101",
    })
    await webhook().handleEvent("installation_repositories", {
      action: "removed",
      installation: { id: 700 },
      repositories_removed: [{ id: 1001 }],
    })
    const fetchRepositories = vi
      .fn<() => Promise<ReturnType<typeof installationRepository>[]>>()
      .mockRejectedValueOnce(new Error("listing failed"))
      .mockResolvedValueOnce([installationRepository(repository)])
    const dependencies = createGitHubWebhookRouteDependencies({
      installationId: "700",
      provider: githubProvider,
      syncRepositories: () => syncGitHubInstallationRepositories(prisma, fetchRepositories),
      webhookSecret: "webhook-secret-for-tests",
    })
    const added = {
      action: "added",
      installation: { id: 700 },
      repositories_added: [{ id: 1001, full_name: repository.nameWithOwner }],
    }

    await expect(dependencies.handleEvent("installation_repositories", added)).rejects.toThrow(
      "listing failed",
    )
    await expect(
      prisma.repository.findUniqueOrThrow({
        select: { removedAt: true },
        where: { id: repository.id },
      }),
    ).resolves.toHaveProperty("removedAt", expect.any(Date))
    expect(await repositoryGrants(member.membershipId)).toEqual([])

    await expect(dependencies.handleEvent("installation_repositories", added)).resolves.toBe(true)

    expect(fetchRepositories).toHaveBeenCalledTimes(2)
    await expect(
      prisma.repository.findUniqueOrThrow({
        include: { prototypes: { include: { builds: true } } },
        where: { id: repository.id },
      }),
    ).resolves.toMatchObject({
      removedAt: null,
      prototypes: [
        {
          id: history.prototypeId,
          currentBuildId: history.buildId,
          builds: [{ id: history.buildId, prototypeId: history.prototypeId }],
        },
      ],
    })
    expect(await repositoryGrants(member.membershipId)).toEqual([])
    await expect(
      prisma.membershipAssignment.findUniqueOrThrow({
        select: { lifecycle: true },
        where: { id: member.providerAssignmentId },
      }),
    ).resolves.toEqual({ lifecycle: "REVOKED" })
    await expect(restore(member.sessions[0]!.digest)).resolves.toBeNull()
  })

  it("requires a fresh installation snapshot before new user evidence can restore access", async () => {
    const revisionId = await createProvider("github")
    const repository = await createRepository(1001, "reconnected")
    const member = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [repository.id],
      subject: "101",
    })
    await webhook().handleEvent("installation_repositories", {
      action: "removed",
      installation: { id: 700 },
      repositories_removed: [{ id: 1001 }],
    })

    async function signInWithRepositoryAccess() {
      const { changedAt } = await prisma.gitHubRepositoryAccessState.findUniqueOrThrow({
        select: { changedAt: true },
        where: { key: "global" },
      })
      if (!changedAt) throw new Error("Missing GitHub access change time.")
      const observedAt = new Date(changedAt.getTime() + 1)
      const attempt = await prisma.authorizationAttempt.create({
        data: {
          browserBindingDigest: randomBytes(32).toString("hex"),
          codeVerifierCiphertext: "encrypted-verifier",
          consumedAt: observedAt,
          createdAt: observedAt,
          expiresAt: new Date("2099-01-01T00:00:00Z"),
          nonceCiphertext: "encrypted-nonce",
          providerRevisionId: revisionId,
          purpose: "SIGN_IN",
          sessionRevocationRevision: 0,
          stateDigest: randomBytes(32).toString("hex"),
          updatedAt: observedAt,
        },
      })
      const sessionDigest = randomBytes(32).toString("hex")
      const admitted = await admitAuthenticationProof(
        {
          proof: {
            authorizationAttemptId: attempt.id,
            externalIdentityId: member.externalIdentityId,
          },
          providerAssignment: {
            assignmentSubject: "github_repository_access",
            issuedAt: observedAt,
            providerRevisionId: revisionId,
            role: "MEMBER",
          },
          providerKey: "github",
          repositoryAccess: [installationRepository(repository)],
          requiresProviderAssignmentEvidence: true,
          sessionDigest,
          sessionId: randomUUID(),
          sessionLifetimeSeconds: 3_600,
        },
        {
          createId: randomUUID,
          getBootstrapSecretDigest: () => "f".repeat(64),
          runTransaction: (operation) => runAdmissionTransaction(prisma, operation),
          writeAudit: (event) => createSecurityAudit(prisma, event),
        },
      )
      return { admitted, sessionDigest }
    }

    await expect(signInWithRepositoryAccess()).rejects.toBeInstanceOf(AdmissionDeniedError)
    await expect(
      prisma.repository.findUniqueOrThrow({
        select: { removedAt: true },
        where: { id: repository.id },
      }),
    ).resolves.toHaveProperty("removedAt", expect.any(Date))
    expect(await repositoryGrants(member.membershipId)).toEqual([])

    await syncGitHubInstallationRepositories(prisma, () =>
      Promise.resolve([installationRepository(repository)]),
    )
    expect(await repositoryGrants(member.membershipId)).toEqual([])
    const newSession = await signInWithRepositoryAccess()

    expect(newSession.admitted).toMatchObject({ role: "MEMBER" })
    expect(await repositoryGrants(member.membershipId)).toEqual([repository.id])
    await expect(restore(newSession.sessionDigest)).resolves.toMatchObject({
      membershipId: member.membershipId,
      role: "MEMBER",
    })
    await expect(restore(member.sessions[0]!.digest)).resolves.toBeNull()
  })

  it("removes stale grants already attached to a disconnected repository when it reconnects", async () => {
    const revisionId = await createProvider("github")
    const repository = await createRepository(1001, "reconnected")
    await prisma.repository.update({
      data: { removedAt: new Date("2026-01-01T00:00:00Z") },
      where: { id: repository.id },
    })
    const member = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [repository.id],
      subject: "101",
    })

    await syncGitHubInstallationRepositories(prisma, () =>
      Promise.resolve([installationRepository(repository)]),
    )

    await expect(
      prisma.repository.findUniqueOrThrow({
        select: { removedAt: true },
        where: { id: repository.id },
      }),
    ).resolves.toEqual({ removedAt: null })
    expect(await repositoryGrants(member.membershipId)).toEqual([])
    await expect(
      prisma.membershipAssignment.findUniqueOrThrow({
        select: { lifecycle: true },
        where: { id: member.providerAssignmentId },
      }),
    ).resolves.toEqual({ lifecycle: "REVOKED" })
    await expect(restore(member.sessions[0]!.digest)).resolves.toBeNull()
  })
})
