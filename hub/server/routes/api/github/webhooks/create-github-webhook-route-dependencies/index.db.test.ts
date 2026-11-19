import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto"
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
    accessLevel: "ADMIN" as const,
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

function deliveryFor(payload: unknown) {
  const body = JSON.stringify(payload)
  if (body === undefined) throw new Error("Webhook payload must be JSON.")
  return {
    id: randomUUID(),
    payloadDigest: createHash("sha256").update(body).digest("hex"),
  }
}

function handleWebhook(name: string, payload: unknown) {
  return webhook().handleEvent(name, payload, deliveryFor(payload))
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

async function signInWithGitHubAccess(input: {
  member: Awaited<ReturnType<typeof createMember>>
  repositories: Awaited<ReturnType<typeof createRepository>>[]
  revisionId: string
  subject: number
}) {
  const { changedAt } = await prisma.gitHubRepositoryAccessState.findUniqueOrThrow({
    select: { changedAt: true },
    where: { key: "global" },
  })
  if (!changedAt) throw new Error("Missing GitHub access change time.")
  const observedAt = new Date(changedAt.getTime() + 1)
  const callbackUri = "https://hub.example.test/api/auth/github/callback"
  const request = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ access_token: "test-user-token", token_type: "bearer" }))
    .mockResolvedValueOnce(Response.json({ id: input.subject }))
    .mockResolvedValueOnce(
      Response.json({
        total_count: input.repositories.length,
        repositories: input.repositories.map((repository) => ({
          default_branch: repository.defaultBranch,
          full_name: repository.nameWithOwner,
          id: Number(repository.githubRepositoryId),
          permissions: {
            admin: true,
            maintain: true,
            pull: true,
            push: true,
            triage: true,
          },
        })),
      }),
    )
  const adapter = createGitHubUserAuthenticationAdapter({
    clientSecret: "test-client-secret",
    fetch: request,
    installationId: 700,
    publicConfiguration: {
      authorizationEndpoint: "https://github.com/login/oauth/authorize",
      callbackUri,
      clientId: "test-client-id",
      tokenEndpoint: "https://github.com/login/oauth/access_token",
      userEndpoint: "https://api.github.com/user",
    },
  })
  const evidence = await adapter.completeAuthenticationProof({
    callbackUri,
    code: "test-code",
    codeVerifier: "test-verifier",
    nonce: "unused-by-github",
  })
  if (!evidence.providerAssignment || !evidence.repositoryAccess) {
    throw new Error("Missing GitHub repository access evidence.")
  }
  const attempt = await prisma.authorizationAttempt.create({
    data: {
      browserBindingDigest: randomBytes(32).toString("hex"),
      codeVerifierCiphertext: "encrypted-verifier",
      consumedAt: observedAt,
      createdAt: observedAt,
      expiresAt: new Date("2099-01-01T00:00:00Z"),
      nonceCiphertext: "encrypted-nonce",
      providerRevisionId: input.revisionId,
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
        externalIdentityId: input.member.externalIdentityId,
      },
      providerAssignment: {
        ...evidence.providerAssignment,
        providerRevisionId: input.revisionId,
      },
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
  )
  return { admitted, request, sessionDigest }
}

describe("createGitHubWebhookRouteDependencies()", () => {
  it("invalidates only the removed team member and retains independent authority", async () => {
    const githubRevisionId = await createProvider("github")
    const entraRevisionId = await createProvider("entra")
    const first = await createRepository(1001, "first")
    const second = await createRepository(1002, "second")
    const affected = await createMember({
      administrator: true,
      provider: "github",
      providerRevisionId: githubRevisionId,
      repositoryIds: [first.id, second.id],
      subject: "101",
    })
    const other = await createMember({
      provider: "github",
      providerRevisionId: githubRevisionId,
      repositoryIds: [first.id, second.id],
      subject: "102",
    })
    const entraIdentity = await prisma.externalIdentity.create({
      data: {
        issuer: "https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0",
        provider: "entra",
        subject: "entra-subject",
        userId: affected.userId,
      },
    })
    const entraAssignment = await prisma.membershipAssignment.create({
      data: {
        externalIdentityId: entraIdentity.id,
        membershipId: affected.membershipId,
        providerAssignmentSubject: randomUUID(),
        providerRevisionId: entraRevisionId,
        role: "MEMBER",
        source: "AUTHENTICATION_PROVIDER",
      },
    })
    const entraSession = await prisma.hubSession.create({
      data: {
        digest: randomBytes(32).toString("hex"),
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        externalIdentityId: entraIdentity.id,
        membershipId: affected.membershipId,
        providerRevisionId: entraRevisionId,
        revocationRevision: 0,
      },
    })
    const payload = {
      action: "removed",
      installation: { id: 700 },
      member: { id: 101 },
      scope: "team",
      team: { id: 77 },
    }

    await expect(handleWebhook("membership", payload)).resolves.toBe(true)

    expect(await repositoryGrants(affected.membershipId)).toEqual([])
    expect(await repositoryGrants(other.membershipId)).toEqual([first.id, second.id].sort())
    await expect(
      prisma.membershipAssignment.findUniqueOrThrow({
        select: { lifecycle: true },
        where: { id: affected.providerAssignmentId },
      }),
    ).resolves.toEqual({ lifecycle: "REVOKED" })
    for (const id of [affected.administratorAssignmentId!, entraAssignment.id]) {
      await expect(
        prisma.membershipAssignment.findUniqueOrThrow({
          select: { lifecycle: true },
          where: { id },
        }),
      ).resolves.toEqual({ lifecycle: "ACTIVE" })
    }
    await expect(
      prisma.membership.findUniqueOrThrow({
        select: { lifecycle: true },
        where: { id: affected.membershipId },
      }),
    ).resolves.toEqual({ lifecycle: "ACTIVE" })
    for (const session of [...affected.sessions, entraSession]) {
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
    const replacementSession = await prisma.hubSession.create({
      data: {
        digest: randomBytes(32).toString("hex"),
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        externalIdentityId: entraIdentity.id,
        membershipId: affected.membershipId,
        providerRevisionId: entraRevisionId,
        revocationRevision: 0,
      },
    })
    await expect(restore(replacementSession.digest)).resolves.toMatchObject({
      membershipId: affected.membershipId,
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
          targetId: affected.providerAssignmentId,
        },
        ...[...affected.sessions, entraSession].map((session) => ({
          action: "session.ended",
          targetId: session.id,
        })),
      ]),
    )

    await expect(handleWebhook("membership", { ...payload, member: { id: 999 } })).resolves.toBe(
      true,
    )
    expect(await repositoryGrants(other.membershipId)).toEqual([first.id, second.id].sort())
    await expect(restore(other.sessions[0]!.digest)).resolves.not.toBeNull()
  })

  it("invalidates a team's repository without disconnecting it and admits refreshed effective access", async () => {
    const revisionId = await createProvider("github")
    const removed = await createRepository(1001, "team-repository")
    const retained = await createRepository(1002, "other-repository")
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
      handleWebhook("team", {
        action: "removed_from_repository",
        installation: { id: 700 },
        repository: { id: 1001 },
        team: { id: 77 },
      }),
    ).resolves.toBe(true)

    await expect(
      prisma.repository.findUniqueOrThrow({
        include: { prototypes: { include: { builds: true } } },
        where: { id: removed.id },
      }),
    ).resolves.toMatchObject({
      removedAt: null,
      prototypes: [
        {
          currentBuildId: history.buildId,
          id: history.prototypeId,
          builds: [{ id: history.buildId }],
        },
      ],
    })
    expect(await repositoryGrants(affected.membershipId)).toEqual([])
    expect(await repositoryGrants(partiallyAffected.membershipId)).toEqual([retained.id])
    expect(await repositoryGrants(unaffected.membershipId)).toEqual([retained.id])
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
      })
    }

    const refreshed = await signInWithGitHubAccess({
      member: affected,
      repositories: [removed],
      revisionId,
      subject: 101,
    })
    expect(refreshed.request.mock.calls[2]?.[0]).toContain("/user/installations/700/repositories")
    expect(refreshed.admitted).toMatchObject({ role: "MEMBER" })
    expect(await repositoryGrants(affected.membershipId)).toEqual([removed.id])
    await expect(restore(refreshed.sessionDigest)).resolves.toMatchObject({
      membershipId: affected.membershipId,
      role: "MEMBER",
    })
    await expect(restore(affected.sessions[0]!.digest)).resolves.toBeNull()
    expect(await repositoryGrants(partiallyAffected.membershipId)).toEqual([retained.id])
  })

  it("invalidates cached admin grants when a team's repository permission is edited", async () => {
    const revisionId = await createProvider("github")
    const changed = await createRepository(1001, "changed-permission")
    const retained = await createRepository(1002, "retained")
    const member = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [changed.id, retained.id],
      subject: "101",
    })
    await prisma.repositoryAccessGrant.update({
      data: { accessLevel: "ADMIN" },
      where: {
        membershipId_repositoryId: {
          membershipId: member.membershipId,
          repositoryId: changed.id,
        },
      },
    })

    await expect(
      handleWebhook("team", {
        action: "edited",
        changes: {
          repository: {
            permissions: { from: { admin: true, pull: true, push: true } },
          },
        },
        installation: { id: 700 },
        repository: { id: 1001 },
        team: { id: 77 },
      }),
    ).resolves.toBe(true)

    expect(await repositoryGrants(member.membershipId)).toEqual([retained.id])
    await expect(restore(member.sessions[0]!.digest)).resolves.toMatchObject({
      membershipId: member.membershipId,
    })
    await expect(
      prisma.repository.findUniqueOrThrow({
        select: { removedAt: true },
        where: { id: changed.id },
      }),
    ).resolves.toEqual({ removedAt: null })
  })

  it.each([
    {
      event: "membership",
      name: "a null team member",
      payload: {
        action: "removed",
        member: null,
        scope: "team",
        team: { id: 77 },
      },
    },
    {
      event: "team",
      name: "an omitted repository",
      payload: { action: "removed_from_repository", team: { id: 77 } },
    },
    {
      event: "team",
      name: "a null repository",
      payload: { action: "removed_from_repository", repository: null, team: { id: 77 } },
    },
    {
      event: "team",
      name: "an omitted repository ID",
      payload: { action: "removed_from_repository", repository: {}, team: { id: 77 } },
    },
    {
      event: "team",
      name: "a null repository ID",
      payload: { action: "removed_from_repository", repository: { id: null }, team: { id: 77 } },
    },
    {
      event: "team",
      name: "a deleted team with no member or repository list",
      payload: { action: "deleted", team: { id: 77 } },
    },
  ])(
    "conservatively invalidates all cached GitHub grants for $name",
    async ({ event, payload }) => {
      const githubRevisionId = await createProvider("github")
      const entraRevisionId = await createProvider("entra")
      const first = await createRepository(1001, "first")
      const second = await createRepository(1002, "second")
      const members = await Promise.all(
        [first, second].map((repository, index) =>
          createMember({
            provider: "github",
            providerRevisionId: githubRevisionId,
            repositoryIds: [repository.id],
            subject: String(101 + index),
          }),
        ),
      )
      const entraMember = await createMember({
        provider: "entra",
        providerRevisionId: entraRevisionId,
        repositoryIds: [],
        subject: "entra-subject",
      })

      await expect(handleWebhook(event, { ...payload, installation: { id: 700 } })).resolves.toBe(
        true,
      )

      for (const member of members) {
        expect(await repositoryGrants(member.membershipId)).toEqual([])
        await expect(
          prisma.membershipAssignment.findUniqueOrThrow({
            select: { lifecycle: true },
            where: { id: member.providerAssignmentId },
          }),
        ).resolves.toEqual({ lifecycle: "REVOKED" })
        await expect(restore(member.sessions[0]!.digest)).resolves.toBeNull()
      }
      for (const repository of [first, second]) {
        await expect(
          prisma.repository.findUniqueOrThrow({
            select: { removedAt: true },
            where: { id: repository.id },
          }),
        ).resolves.toEqual({ removedAt: null })
      }
      await expect(restore(entraMember.sessions[0]!.digest)).resolves.toMatchObject({
        membershipId: entraMember.membershipId,
        role: "MEMBER",
      })
    },
  )

  it("rejects malformed security actions without changing access or recording a receipt", async () => {
    const revisionId = await createProvider("github")
    const repository = await createRepository(1001, "retained")
    const member = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [repository.id],
      subject: "101",
    })
    const fence = await prisma.gitHubRepositoryAccessState.findUniqueOrThrow({
      select: { changedAt: true, revision: true },
      where: { key: "global" },
    })
    const malformed = [
      { event: "membership", payload: { action: "removed", member: { id: 101 }, scope: "team" } },
      {
        event: "membership",
        payload: { action: "removed", member: { id: 101 }, scope: "team", team: { id: 0 } },
      },
      {
        event: "membership",
        payload: { action: "removed", scope: "team", team: { id: 77 } },
      },
      {
        event: "membership",
        payload: { action: "removed", member: { id: "101" }, scope: "team", team: { id: 77 } },
      },
      { event: "team", payload: { action: "removed_from_repository", repository: { id: 1001 } } },
      {
        event: "team",
        payload: {
          action: "removed_from_repository",
          repository: { id: 1001 },
          team: { id: "77" },
        },
      },
      {
        event: "team",
        payload: {
          action: "removed_from_repository",
          repository: { id: "1001" },
          team: { id: 77 },
        },
      },
      { event: "team", payload: { action: "deleted" } },
      { event: "team", payload: { action: "deleted", team: { id: null } } },
      {
        event: "member",
        payload: { action: "removed", member: { id: 101 }, repository: { id: "1001" } },
      },
      {
        event: "organization",
        payload: { action: "member_removed", membership: { user: { id: "101" } } },
      },
      { event: "installation_repositories", payload: { action: "removed" } },
    ]

    for (const { event, payload } of malformed) {
      await expect(handleWebhook(event, payload)).rejects.toThrow()
    }
    expect(await repositoryGrants(member.membershipId)).toEqual([repository.id])
    await expect(restore(member.sessions[0]!.digest)).resolves.toMatchObject({
      membershipId: member.membershipId,
    })
    await expect(
      prisma.gitHubRepositoryAccessState.findUniqueOrThrow({
        select: { changedAt: true, revision: true },
        where: { key: "global" },
      }),
    ).resolves.toEqual(fence)
    expect(await prisma.gitHubWebhookDelivery.count()).toBe(0)
  })

  it("ignores membership additions and unrelated team actions without recording a receipt", async () => {
    const revisionId = await createProvider("github")
    const repository = await createRepository(1001, "retained")
    const member = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [repository.id],
      subject: "101",
    })
    const fence = await prisma.gitHubRepositoryAccessState.findUniqueOrThrow({
      select: { changedAt: true, revision: true },
      where: { key: "global" },
    })
    for (const [event, payload] of [
      ["membership", { action: "added", member: { id: 101 }, scope: "team", team: { id: 77 } }],
      [
        "membership",
        { action: "removed", member: { id: 101 }, scope: "organization", team: { id: 77 } },
      ],
      ["team", { action: "created", team: { id: 77 } }],
    ] as const) {
      await expect(handleWebhook(event, payload)).resolves.toBe(false)
    }
    expect(await repositoryGrants(member.membershipId)).toEqual([repository.id])
    await expect(restore(member.sessions[0]!.digest)).resolves.not.toBeNull()
    await expect(
      prisma.gitHubRepositoryAccessState.findUniqueOrThrow({
        select: { changedAt: true, revision: true },
        where: { key: "global" },
      }),
    ).resolves.toEqual(fence)
    expect(await prisma.gitHubWebhookDelivery.count()).toBe(0)
  })

  it.each([
    {
      disconnect: false,
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
      disconnect: false,
      event: "organization",
      name: "organization removal",
      payload: {
        action: "member_removed",
        installation: { id: 700 },
        membership: { user: { id: 101 } },
      },
    },
    {
      disconnect: true,
      event: "installation_repositories",
      name: "installation repository removal",
      payload: {
        action: "removed",
        installation: { id: 700 },
        repositories_removed: [{ id: 1001 }],
      },
    },
    {
      disconnect: true,
      event: "installation",
      name: "installation suspension",
      payload: { action: "suspend", installation: { id: 700 } },
    },
    {
      disconnect: true,
      event: "installation",
      name: "installation deletion",
      payload: { action: "deleted", installation: { id: 700 } },
    },
    {
      disconnect: false,
      event: "membership",
      name: "team member removal",
      payload: {
        action: "removed",
        installation: { id: 700 },
        member: { id: 101 },
        scope: "team",
        team: { id: 77 },
      },
    },
    {
      disconnect: false,
      event: "team",
      name: "team repository removal",
      payload: {
        action: "removed_from_repository",
        installation: { id: 700 },
        repository: { id: 1001 },
        team: { id: 77 },
      },
    },
    {
      disconnect: false,
      event: "team",
      name: "team deletion",
      payload: { action: "deleted", installation: { id: 700 }, team: { id: 77 } },
    },
  ])(
    "applies a replay of $name once but applies the same body under a new delivery ID",
    async ({ disconnect, event, payload }) => {
      const revisionId = await createProvider("github")
      const repository = await createRepository(1001, "accessible")
      const member = await createMember({
        provider: "github",
        providerRevisionId: revisionId,
        repositoryIds: [repository.id],
        subject: "101",
      })
      const dependencies = webhook()
      const delivery = deliveryFor(payload)

      await expect(dependencies.handleEvent(event, payload, delivery)).resolves.toBe(true)
      expect(await repositoryGrants(member.membershipId)).toEqual([])
      if (disconnect) {
        await syncGitHubInstallationRepositories(prisma, () =>
          Promise.resolve([installationRepository(repository)]),
        )
      }
      const refreshed = await signInWithGitHubAccess({
        member,
        repositories: [repository],
        revisionId,
        subject: 101,
      })
      expect(await repositoryGrants(member.membershipId)).toEqual([repository.id])
      const fence = await prisma.gitHubRepositoryAccessState.findUniqueOrThrow({
        select: { changedAt: true, revision: true },
        where: { key: "global" },
      })
      const auditCount = await prisma.securityAudit.count()

      await expect(dependencies.handleEvent(event, payload, delivery)).resolves.toBe(true)
      expect(await repositoryGrants(member.membershipId)).toEqual([repository.id])
      await expect(restore(refreshed.sessionDigest)).resolves.toMatchObject({
        membershipId: member.membershipId,
      })
      await expect(
        prisma.gitHubRepositoryAccessState.findUniqueOrThrow({
          select: { changedAt: true, revision: true },
          where: { key: "global" },
        }),
      ).resolves.toEqual(fence)
      expect(await prisma.securityAudit.count()).toBe(auditCount)

      const nextDelivery = { ...delivery, id: randomUUID() }
      await expect(dependencies.handleEvent(event, payload, nextDelivery)).resolves.toBe(true)
      expect(await repositoryGrants(member.membershipId)).toEqual([])
      await expect(restore(refreshed.sessionDigest)).resolves.toBeNull()
      await expect(
        prisma.gitHubRepositoryAccessState.findUniqueOrThrow({
          select: { revision: true },
          where: { key: "global" },
        }),
      ).resolves.toEqual({ revision: fence.revision + 1 })
      await expect(
        prisma.gitHubWebhookDelivery.findMany({
          orderBy: { id: "asc" },
          select: { event: true, id: true, payloadDigest: true },
          where: { id: { in: [delivery.id, nextDelivery.id] } },
        }),
      ).resolves.toEqual(
        [delivery.id, nextDelivery.id].sort().map((id) => ({
          event,
          id,
          payloadDigest: delivery.payloadDigest,
        })),
      )
    },
    15_000,
  )

  it("rejects a reused delivery ID with a different event or raw-body digest", async () => {
    const revisionId = await createProvider("github")
    const repository = await createRepository(1001, "accessible")
    const member = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [repository.id],
      subject: "101",
    })
    const payload = {
      action: "removed",
      installation: { id: 700 },
      member: { id: 101 },
      repository: { id: 1001 },
      scope: "team",
      team: { id: 77 },
    }
    const delivery = deliveryFor(payload)
    const dependencies = webhook()
    await dependencies.handleEvent("membership", payload, delivery)
    const refreshed = await signInWithGitHubAccess({
      member,
      repositories: [repository],
      revisionId,
      subject: 101,
    })
    const fence = await prisma.gitHubRepositoryAccessState.findUniqueOrThrow({
      select: { changedAt: true, revision: true },
      where: { key: "global" },
    })
    const changedPayload = { ...payload, member: { id: 102 } }
    const conflictingBody = { ...deliveryFor(changedPayload), id: delivery.id }

    await expect(
      dependencies.handleEvent("membership", changedPayload, conflictingBody),
    ).rejects.toThrow()
    await expect(dependencies.handleEvent("member", payload, delivery)).rejects.toThrow()

    expect(await repositoryGrants(member.membershipId)).toEqual([repository.id])
    await expect(restore(refreshed.sessionDigest)).resolves.toMatchObject({
      membershipId: member.membershipId,
    })
    await expect(
      prisma.gitHubRepositoryAccessState.findUniqueOrThrow({
        select: { changedAt: true, revision: true },
        where: { key: "global" },
      }),
    ).resolves.toEqual(fence)
    await expect(
      prisma.gitHubWebhookDelivery.findUniqueOrThrow({
        select: { event: true, payloadDigest: true },
        where: { id: delivery.id },
      }),
    ).resolves.toEqual({ event: "membership", payloadDigest: delivery.payloadDigest })
  })

  it("applies simultaneous copies of one delivery only once", async () => {
    const revisionId = await createProvider("github")
    const repository = await createRepository(1001, "accessible")
    const member = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [repository.id],
      subject: "101",
    })
    const payload = {
      action: "removed",
      installation: { id: 700 },
      member: { id: 101 },
      scope: "team",
      team: { id: 77 },
    }
    const delivery = deliveryFor(payload)
    const dependencies = webhook()
    const fence = await prisma.gitHubRepositoryAccessState.findUniqueOrThrow({
      select: { revision: true },
      where: { key: "global" },
    })

    await expect(
      Promise.all([
        dependencies.handleEvent("membership", payload, delivery),
        dependencies.handleEvent("membership", payload, delivery),
      ]),
    ).resolves.toEqual([true, true])

    expect(await repositoryGrants(member.membershipId)).toEqual([])
    await expect(restore(member.sessions[0]!.digest)).resolves.toBeNull()
    await expect(
      prisma.gitHubRepositoryAccessState.findUniqueOrThrow({
        select: { revision: true },
        where: { key: "global" },
      }),
    ).resolves.toEqual({ revision: fence.revision + 1 })
    expect(await prisma.gitHubWebhookDelivery.count()).toBe(1)
    expect(
      await prisma.securityAudit.count({
        where: { action: { in: ["provider.membership.assignment.revoked", "session.ended"] } },
      }),
    ).toBe(2)
  })

  it("invalidates only an edited collaborator grant while another grant keeps the session usable", async () => {
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
      handleWebhook("member", {
        action: "edited",
        changes: { permission: { from: "admin" } },
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

      await expect(handleWebhook(event, payload)).resolves.toBe(true)

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
    const legacy = await createRepository(null, "legacy")
    const alreadyDisconnected = await createRepository(1003, "already-disconnected")
    await prisma.repository.update({
      data: { removedAt: new Date("2026-01-01T00:00:00Z") },
      where: { id: alreadyDisconnected.id },
    })
    const history = await createHistory(removed.id)
    const affected = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [removed.id],
      subject: "101",
    })
    const legacyGrantOnly = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [removed.id, legacy.id],
      subject: "104",
    })
    const disconnectedGrantOnly = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [removed.id, alreadyDisconnected.id],
      subject: "105",
    })
    const partiallyAffected = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [removed.id, retained.id, legacy.id],
      subject: "102",
    })
    const unaffected = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [retained.id],
      subject: "103",
    })

    await expect(
      handleWebhook("installation_repositories", {
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
    await expect(
      prisma.repository.findUniqueOrThrow({
        select: { githubRepositoryId: true, nameWithOwner: true, removedAt: true },
        where: { id: legacy.id },
      }),
    ).resolves.toEqual({
      githubRepositoryId: null,
      nameWithOwner: legacy.nameWithOwner,
      removedAt: null,
    })
    expect(await repositoryGrants(affected.membershipId)).toEqual([])
    const remainingGrants = await repositoryGrants(partiallyAffected.membershipId)
    expect(remainingGrants).toContain(retained.id)
    expect(remainingGrants).not.toContain(removed.id)
    expect(await repositoryGrants(unaffected.membershipId)).toEqual([retained.id])
    for (const member of [affected, legacyGrantOnly, disconnectedGrantOnly]) {
      expect(await repositoryGrants(member.membershipId)).not.toContain(removed.id)
      await expect(
        prisma.membershipAssignment.findUniqueOrThrow({
          select: { lifecycle: true },
          where: { id: member.providerAssignmentId },
        }),
      ).resolves.toEqual({ lifecycle: "REVOKED" })
      await expect(restore(member.sessions[0]!.digest)).resolves.toBeNull()
    }
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
    for (const member of [affected, legacyGrantOnly, disconnectedGrantOnly]) {
      expect(audits).toEqual(
        expect.arrayContaining([
          {
            action: "provider.membership.assignment.revoked",
            targetId: member.providerAssignmentId,
          },
          { action: "session.ended", targetId: member.sessions[0]!.id },
        ]),
      )
    }
    expect(audits).toHaveLength(6)
  })

  it.each(["suspend", "deleted"] as const)(
    "disconnects installation repositories and revokes GitHub access after installation %s",
    async (action) => {
      const githubRevisionId = await createProvider("github")
      const entraRevisionId = await createProvider("entra")
      const first = await createRepository(1001, "first")
      const second = await createRepository(1002, "second")
      const legacy = await createRepository(null, "legacy")
      const history = await createHistory(first.id)
      const legacyHistory = await createHistory(legacy.id)
      const reviewAuthor = await prisma.user.create({ data: {} })
      await prisma.reviewThread.create({
        data: {
          repositoryId: legacy.id,
          prototypeId: legacyHistory.prototypeId,
          buildId: legacyHistory.buildId,
          anchor: { schemaVersion: 1, kind: "element", selector: "#content" },
          comments: {
            create: { authorId: reviewAuthor.id, authorLogin: "mona", body: "Retained review" },
          },
        },
      })
      const legacyBefore = await prisma.repository.findUniqueOrThrow({
        include: {
          prototypes: { include: { builds: true } },
          reviewThreads: { include: { comments: true } },
        },
        where: { id: legacy.id },
      })
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
        handleWebhook("installation", { action, installation: { id: 700 } }),
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
      const retainedLegacy = await prisma.repository.findUniqueOrThrow({
        include: {
          prototypes: { include: { builds: true } },
          reviewThreads: { include: { comments: true } },
        },
        where: { id: legacy.id },
      })
      expect(retainedLegacy).toEqual(legacyBefore)
      expect(retainedLegacy).toMatchObject({
        githubRepositoryId: null,
        id: legacy.id,
        nameWithOwner: legacy.nameWithOwner,
        prototypes: [
          {
            id: legacyHistory.prototypeId,
            currentBuildId: legacyHistory.buildId,
            builds: [{ id: legacyHistory.buildId, prototypeId: legacyHistory.prototypeId }],
          },
        ],
      })
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
    {
      event: "membership",
      name: "team membership removal",
      payload: {
        action: "removed",
        installation: { id: 700 },
        member: { id: 101 },
        scope: "team",
        team: { id: 77 },
      },
    },
    {
      event: "team",
      name: "team repository removal",
      payload: {
        action: "removed_from_repository",
        installation: { id: 700 },
        repository: { id: 1001 },
        team: { id: 77 },
      },
    },
  ])(
    "rolls back $name and retries the same delivery after an audit failure",
    async ({ event, payload }) => {
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
      const delivery = deliveryFor(payload)
      const dependencies = webhook()
      const fence = await prisma.gitHubRepositoryAccessState.findUniqueOrThrow({
        select: { changedAt: true, revision: true },
        where: { key: "global" },
      })

      await withFailingSecurityAudit("session.ended", () =>
        expect(dependencies.handleEvent(event, payload, delivery)).rejects.toThrow(),
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
      await expect(
        prisma.gitHubRepositoryAccessState.findUniqueOrThrow({
          select: { changedAt: true, revision: true },
          where: { key: "global" },
        }),
      ).resolves.toEqual(fence)
      await expect(
        prisma.gitHubWebhookDelivery.findUnique({ where: { id: delivery.id } }),
      ).resolves.toBeNull()

      await expect(dependencies.handleEvent(event, payload, delivery)).resolves.toBe(true)
      expect(await repositoryGrants(affected.membershipId)).toEqual([])
      await expect(restore(affected.sessions[0]!.digest)).resolves.toBeNull()
      await expect(
        prisma.gitHubWebhookDelivery.findUniqueOrThrow({
          select: { event: true, payloadDigest: true },
          where: { id: delivery.id },
        }),
      ).resolves.toEqual({ event, payloadDigest: delivery.payloadDigest })
    },
  )

  it.each([
    {
      disconnect: false,
      kind: "collaborator",
      name: "the final collaborator grant",
      retainAnother: false,
    },
    {
      disconnect: false,
      kind: "collaborator",
      name: "one of two collaborator grants",
      retainAnother: true,
    },
    {
      disconnect: true,
      kind: "installation",
      name: "an installation repository",
      retainAnother: false,
    },
    {
      disconnect: false,
      kind: "membership",
      name: "a removed team member's grants",
      retainAnother: false,
    },
    {
      disconnect: false,
      kind: "team",
      name: "a removed team's repository grant",
      retainAnother: true,
    },
    {
      disconnect: false,
      kind: "teamPermission",
      name: "an edited team's repository permission",
      retainAnother: true,
    },
  ] as const)(
    "does not regrant $name from an older in-flight GitHub access snapshot",
    async ({ disconnect, kind, retainAnother }) => {
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
          accessLevel: "ADMIN" as const,
          defaultBranch: repository.defaultBranch,
          githubRepositoryId: Number(repository.githubRepositoryId),
          nameWithOwner: repository.nameWithOwner,
        }),
      )

      const event = {
        collaborator: {
          name: "member",
          payload: {
            action: "edited",
            changes: { permission: { from: "admin" } },
            installation: { id: 700 },
            member: { id: 101 },
            repository: { id: 1001 },
          },
        },
        installation: {
          name: "installation_repositories",
          payload: {
            action: "removed",
            installation: { id: 700 },
            repositories_removed: [{ id: 1001 }],
          },
        },
        membership: {
          name: "membership",
          payload: {
            action: "removed",
            installation: { id: 700 },
            member: { id: 101 },
            scope: "team",
            team: { id: 77 },
          },
        },
        team: {
          name: "team",
          payload: {
            action: "removed_from_repository",
            installation: { id: 700 },
            repository: { id: 1001 },
            team: { id: 77 },
          },
        },
        teamPermission: {
          name: "team",
          payload: {
            action: "edited",
            changes: {
              repository: {
                permissions: { from: { admin: true, pull: true, push: true } },
              },
            },
            installation: { id: 700 },
            repository: { id: 1001 },
            team: { id: 77 },
          },
        },
      }[kind]
      await expect(handleWebhook(event.name, event.payload)).resolves.toBe(true)
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
              permissions: {
                admin: true,
                maintain: true,
                pull: true,
                push: true,
                triage: true,
              },
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
  it.each(["empty installation", "unchanged GitHub ID"] as const)(
    "preserves a missing legacy repository after a complete %s snapshot",
    async (snapshotType) => {
      await createProvider("github")
      const legacy = await createRepository(null, "missing-legacy")
      const history = await createHistory(legacy.id)
      const legacyBefore = await prisma.repository.findUniqueOrThrow({
        include: { prototypes: { include: { builds: true } } },
        where: { id: legacy.id },
      })
      const retained =
        snapshotType === "unchanged GitHub ID" ? await createRepository(1001, "retained") : null
      const snapshot = retained ? [installationRepository(retained)] : []

      await expect(
        syncGitHubInstallationRepositories(prisma, () => Promise.resolve(snapshot)),
      ).resolves.toEqual(snapshot)

      const retainedLegacy = await prisma.repository.findUniqueOrThrow({
        include: { prototypes: { include: { builds: true } } },
        where: { id: legacy.id },
      })
      expect(retainedLegacy).toEqual(legacyBefore)
      expect(retainedLegacy).toMatchObject({
        defaultBranch: legacy.defaultBranch,
        githubRepositoryId: null,
        id: legacy.id,
        nameWithOwner: legacy.nameWithOwner,
        prototypes: [
          {
            id: history.prototypeId,
            currentBuildId: history.buildId,
            builds: [{ id: history.buildId, prototypeId: history.prototypeId }],
          },
        ],
      })
      if (retained) {
        await expect(
          prisma.repository.findUniqueOrThrow({
            select: { removedAt: true },
            where: { id: retained.id },
          }),
        ).resolves.toEqual({ removedAt: null })
      }
    },
  )

  it("retains history and user access when an ID-backed repository is renamed", async () => {
    const revisionId = await createProvider("github")
    const repository = await createRepository(1001, "old-name")
    const history = await createHistory(repository.id)
    const member = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [repository.id],
      subject: "101",
    })
    const renamed = {
      defaultBranch: "trunk",
      githubRepositoryId: 1001,
      nameWithOwner: "team/new-name",
    }

    await syncGitHubInstallationRepositories(prisma, () => Promise.resolve([renamed]))

    await expect(
      prisma.repository.findUniqueOrThrow({
        include: { prototypes: { include: { builds: true } } },
        where: { id: repository.id },
      }),
    ).resolves.toMatchObject({
      defaultBranch: "trunk",
      githubRepositoryId: 1001n,
      nameWithOwner: "team/new-name",
      removedAt: null,
      prototypes: [
        {
          id: history.prototypeId,
          currentBuildId: history.buildId,
          builds: [{ id: history.buildId, prototypeId: history.prototypeId }],
        },
      ],
    })
    expect(await prisma.repository.count()).toBe(1)
    expect(await repositoryGrants(member.membershipId)).toEqual([repository.id])
    await expect(restore(member.sessions[0]!.digest)).resolves.toMatchObject({
      membershipId: member.membershipId,
      role: "MEMBER",
    })
  })

  it("quarantines legacy history when an installed repository reuses its name", async () => {
    const revisionId = await createProvider("github")
    const legacy = await createRepository(null, "reused-name")
    const history = await createHistory(legacy.id)
    const legacyBefore = await prisma.repository.findUniqueOrThrow({
      include: { prototypes: { include: { builds: true } } },
      where: { id: legacy.id },
    })
    const member = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [],
      subject: "101",
    })
    const snapshot = [
      { defaultBranch: "main", githubRepositoryId: 1001, nameWithOwner: legacy.nameWithOwner },
    ]

    await syncGitHubInstallationRepositories(prisma, () => Promise.resolve(snapshot))

    const retainedLegacy = await prisma.repository.findUniqueOrThrow({
      include: { prototypes: { include: { builds: true } } },
      where: { id: legacy.id },
    })
    expect(retainedLegacy).toEqual(legacyBefore)
    expect(retainedLegacy).toMatchObject({
      defaultBranch: legacy.defaultBranch,
      githubRepositoryId: null,
      id: legacy.id,
      nameWithOwner: legacy.nameWithOwner,
      prototypes: [
        {
          id: history.prototypeId,
          currentBuildId: history.buildId,
          builds: [{ id: history.buildId, prototypeId: history.prototypeId }],
        },
      ],
    })
    const current = await prisma.repository.findUniqueOrThrow({
      include: { prototypes: true },
      where: { githubRepositoryId: 1001n },
    })
    expect(current).toMatchObject({ nameWithOwner: legacy.nameWithOwner, prototypes: [] })
    expect(current.id).not.toBe(legacy.id)
    expect(await repositoryGrants(member.membershipId)).toEqual([])
  })

  it("admits user-specific access when a disconnected legacy repository has the same name", async () => {
    const revisionId = await createProvider("github")
    await syncGitHubInstallationRepositories(prisma, () =>
      Promise.resolve([
        { defaultBranch: "main", githubRepositoryId: 1001, nameWithOwner: "team/reused-name" },
      ]),
    )
    const current = await prisma.repository.findUniqueOrThrow({
      where: { githubRepositoryId: 1001n },
    })
    const legacy = await createRepository(null, "reused-name")
    const history = await createHistory(legacy.id)
    await prisma.repository.update({
      data: { removedAt: new Date("2026-01-01T00:00:00Z") },
      where: { id: legacy.id },
    })
    const member = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [],
      subject: "101",
    })

    const authenticated = await signInWithGitHubAccess({
      member,
      repositories: [current],
      revisionId,
      subject: 101,
    })
    expect(await repositoryGrants(member.membershipId)).toEqual([current.id])
    await expect(restore(authenticated.sessionDigest)).resolves.toMatchObject({
      membershipId: member.membershipId,
      role: "MEMBER",
    })
    await expect(
      prisma.repository.findUniqueOrThrow({
        include: { prototypes: { select: { id: true } } },
        where: { id: legacy.id },
      }),
    ).resolves.toMatchObject({
      githubRepositoryId: null,
      nameWithOwner: legacy.nameWithOwner,
      prototypes: [{ id: history.prototypeId }],
    })
  })

  it("denies user evidence for a disconnected GitHub ID even after a rename", async () => {
    const revisionId = await createProvider("github")
    const repository = await createRepository(1001, "old-name")
    await handleWebhook("installation_repositories", {
      action: "removed",
      installation: { id: 700 },
      repositories_removed: [{ id: 1001 }],
    })
    const member = await createMember({
      provider: "github",
      providerRevisionId: revisionId,
      repositoryIds: [],
      subject: "101",
    })

    await expect(
      signInWithGitHubAccess({
        member,
        repositories: [{ ...repository, nameWithOwner: "team/new-name" }],
        revisionId,
        subject: 101,
      }),
    ).rejects.toBeInstanceOf(AdmissionDeniedError)
    expect(await repositoryGrants(member.membershipId)).toEqual([])
    await expect(
      prisma.repository.findUniqueOrThrow({
        select: { removedAt: true },
        where: { id: repository.id },
      }),
    ).resolves.toHaveProperty("removedAt", expect.any(Date))
  })

  it("rejects stale provider work without consuming a delivery that the current provider can retry", async () => {
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
    const payload = {
      action: "removed_from_repository",
      installation: { id: 700 },
      repository: { id: 1001 },
      team: { id: 77 },
    }
    const delivery = deliveryFor(payload)
    const fence = await prisma.gitHubRepositoryAccessState.findUniqueOrThrow({
      select: { changedAt: true, revision: true },
      where: { key: "global" },
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
      handleWebhook("installation", {
        action: "deleted",
        installation: { id: 700 },
      }),
    ).rejects.toThrow("not the selected authentication configuration")
    await expect(webhook().handleEvent("team", payload, delivery)).rejects.toThrow(
      "not the selected authentication configuration",
    )

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
    await expect(
      prisma.gitHubRepositoryAccessState.findUniqueOrThrow({
        select: { changedAt: true, revision: true },
        where: { key: "global" },
      }),
    ).resolves.toEqual(fence)
    await expect(
      prisma.gitHubWebhookDelivery.findUnique({ where: { id: delivery.id } }),
    ).resolves.toBeNull()

    const currentDependencies = createGitHubWebhookRouteDependencies({
      installationId: "700",
      provider: { configurationDigest: "b".repeat(64), revision: 2 },
      syncRepositories: () => {
        throw new Error("Removal events must not sync repositories.")
      },
      webhookSecret: "webhook-secret-for-tests",
    })
    await expect(currentDependencies.handleEvent("team", payload, delivery)).resolves.toBe(true)
    expect(await repositoryGrants(member.membershipId)).toEqual([])
    await expect(restore(member.sessions[0]!.digest)).resolves.toBeNull()
    await expect(
      prisma.gitHubWebhookDelivery.findUniqueOrThrow({
        select: { event: true, payloadDigest: true },
        where: { id: delivery.id },
      }),
    ).resolves.toEqual({ event: "team", payloadDigest: delivery.payloadDigest })
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
      {
        accessLevel: "ADMIN" as const,
        defaultBranch: "main",
        githubRepositoryId: 1003,
        nameWithOwner: "team/stale-only",
      },
    ]
    const freshSnapshot = [installationRepository(retained)]
    const fetchRepositories = vi
      .fn<() => Promise<typeof freshSnapshot>>()
      .mockImplementationOnce(async () => {
        await expect(
          handleWebhook("installation_repositories", {
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
      const legacy = await createRepository(null, "incoming-0")
      await createHistory(legacy.id)
      const legacyBefore = await prisma.repository.findUniqueOrThrow({
        include: { prototypes: { include: { builds: true } } },
        where: { id: legacy.id },
      })
      const fenceBefore = await prisma.gitHubRepositoryAccessState.findUniqueOrThrow({
        where: { key: "global" },
      })
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
        prisma.repository.findUniqueOrThrow({
          select: { githubRepositoryId: true, removedAt: true },
          where: { id: retained.id },
        }),
      ).resolves.toEqual({ githubRepositoryId: 1001n, removedAt: null })
      await expect(
        prisma.repository.findUniqueOrThrow({
          include: { prototypes: { include: { builds: true } } },
          where: { id: legacy.id },
        }),
      ).resolves.toEqual(legacyBefore)
      expect(await prisma.repository.count()).toBe(2)
      await expect(
        prisma.gitHubRepositoryAccessState.findUniqueOrThrow({ where: { key: "global" } }),
      ).resolves.toEqual(fenceBefore)
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
    const legacy = await createRepository(null, "incoming")
    const history = await createHistory(legacy.id)
    const fenceBefore = await prisma.gitHubRepositoryAccessState.findUniqueOrThrow({
      where: { key: "global" },
    })
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
      prisma.repository.findUniqueOrThrow({
        select: { githubRepositoryId: true, removedAt: true },
        where: { id: existing.id },
      }),
    ).resolves.toEqual({ githubRepositoryId: 1001n, removedAt: null })
    await expect(
      prisma.repository.findUniqueOrThrow({
        include: { prototypes: { include: { builds: true } } },
        where: { id: legacy.id },
      }),
    ).resolves.toMatchObject({
      githubRepositoryId: null,
      removedAt: null,
      prototypes: [
        {
          id: history.prototypeId,
          currentBuildId: history.buildId,
          builds: [{ id: history.buildId, prototypeId: history.prototypeId }],
        },
      ],
    })
    expect(await prisma.repository.count()).toBe(2)
    await expect(
      prisma.gitHubRepositoryAccessState.findUniqueOrThrow({ where: { key: "global" } }),
    ).resolves.toEqual(fenceBefore)
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
    await handleWebhook("installation_repositories", {
      action: "removed",
      installation: { id: 700 },
      repositories_removed: [{ id: 1001 }],
    })
    const fetchRepositories = vi
      .fn<() => Promise<ReturnType<typeof installationRepository>[]>>()
      .mockRejectedValueOnce(new Error("listing failed"))
      .mockResolvedValue([installationRepository(repository)])
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
    const delivery = deliveryFor(added)

    await expect(
      dependencies.handleEvent("installation_repositories", added, delivery),
    ).rejects.toThrow("listing failed")
    await expect(
      prisma.repository.findUniqueOrThrow({
        select: { removedAt: true },
        where: { id: repository.id },
      }),
    ).resolves.toHaveProperty("removedAt", expect.any(Date))
    expect(await repositoryGrants(member.membershipId)).toEqual([])

    await expect(
      dependencies.handleEvent("installation_repositories", added, delivery),
    ).resolves.toBe(true)
    await expect(
      dependencies.handleEvent("installation_repositories", added, delivery),
    ).resolves.toBe(true)

    expect(fetchRepositories).toHaveBeenCalledTimes(3)
    await expect(
      prisma.gitHubWebhookDelivery.findUnique({ where: { id: delivery.id } }),
    ).resolves.toBeNull()
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
    await handleWebhook("installation_repositories", {
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
