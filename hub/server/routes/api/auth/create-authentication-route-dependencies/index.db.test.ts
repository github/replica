import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto"
import { Client } from "pg"
import { describe, expect, it, vi } from "vitest"

import { restoreHubSession } from "../../../../domains/admission/restore-hub-session"
import { runSessionRestoreTransaction } from "../../../../domains/admission/run-session-restore-transaction"
import { syncGitHubInstallationRepositories } from "../../../../domains/admission/sync-github-installation-repositories"
import { AdmissionUnavailableError } from "../../../../domains/admission/errors"
import { createEntraAuthenticationContext } from "../../../../domains/authentication/create-entra-authentication-context"
import { createGitHubAuthenticationContext } from "../../../../domains/authentication/create-github-authentication-context"
import { activateGitHubRepositoryScoping } from "../../../../domains/identity/activate-github-repository-scoping"
import { getSelectedProviderRevision } from "../../../../domains/identity/get-selected-provider-revision"
import { runProviderRevisionTransaction } from "../../../../domains/identity/run-provider-revision-transaction"
import { Prisma } from "../../../../generated/prisma/client"
import { prisma } from "../../../../integrations/prisma"
import { getDatabaseUrl } from "../../../../../test/database/get-database-url"
import { findAuthenticationProvider } from "../../../../repositories/authentication-providers/find-authentication-provider"
import { listOpenGitHubSessionMemberships } from "../../../../repositories/hub-sessions/list-open-github-session-memberships"
import { withFailingSecurityAudit } from "../../../../../test/database/with-failing-security-audit"
import { createAuthenticationRouteDependencies, disableAuthenticationProviders } from "."

const tenantId = "11111111-1111-4111-8111-111111111111"
const entraClientId = "22222222-2222-4222-8222-222222222222"
const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`
const githubPrivateKey = Buffer.from(
  generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
    format: "pem",
    type: "pkcs1",
  }),
).toString("base64")

function environment(input: {
  entra?: boolean
  entraRevision?: number
  github?: boolean
  githubClientId?: string
  githubRevision?: number
}) {
  return {
    HUB_APPLICATION_ORIGIN: "https://hub.example.test",
    HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    HUB_BOOTSTRAP_SECRET: "bootstrap-secret-that-is-at-least-32-characters",
    ...(input.github
      ? {
          GITHUB_CLIENT_ID: input.githubClientId ?? "github-client",
          GITHUB_CLIENT_SECRET: "github-secret",
          GITHUB_PROVIDER_REVISION: String(input.githubRevision ?? 1),
          GITHUB_APP_ID: "123",
          GITHUB_APP_INSTALLATION_ID: "456",
          GITHUB_APP_PRIVATE_KEY_BASE64: githubPrivateKey,
          GITHUB_WEBHOOK_SECRET: "webhook-secret-at-least-twenty-characters",
        }
      : {}),
    ...(input.entra
      ? {
          ENTRA_OIDC_CLIENT_AUTHENTICATION: "client-secret",
          ENTRA_OIDC_CLIENT_ID: entraClientId,
          ENTRA_OIDC_CLIENT_SECRET: "entra-secret",
          ENTRA_OIDC_ISSUER: issuer,
          ENTRA_OIDC_PROVIDER_REVISION: String(input.entraRevision ?? 1),
        }
      : {}),
  }
}

function discovery(overrides: Record<string, unknown> = {}) {
  return Response.json({
    authorization_endpoint: `${issuer}/oauth2/v2.0/authorize`,
    id_token_signing_alg_values_supported: ["RS256"],
    issuer,
    jwks_uri: `${issuer}/discovery/v2.0/keys`,
    token_endpoint: `${issuer}/oauth2/v2.0/token`,
    ...overrides,
  })
}

const validDiscovery = vi.fn<typeof fetch>(() => Promise.resolve(discovery()))

async function seedConfiguredProviders(configuration: NodeJS.ProcessEnv) {
  const contexts = [
    createEntraAuthenticationContext(configuration, validDiscovery),
    createGitHubAuthenticationContext(configuration, validDiscovery),
  ]
  await runProviderRevisionTransaction(prisma, async (repositories) => {
    const existing = new Set(
      (await repositories.lockAuthenticationProviders()).map((provider) => provider.key),
    )
    for (const context of contexts) {
      if (existing.has(context.adapter.providerKey)) continue
      const providerId = randomUUID()
      const revisionId = randomUUID()
      await repositories.createAuthenticationProvider({
        id: providerId,
        key: context.adapter.providerKey,
      })
      await repositories.createAuthenticationProviderRevision({
        configurationDigest: context.configurationDigest,
        id: revisionId,
        providerId,
        revision: context.providerRevision,
      })
      await repositories.selectAuthenticationProviderRevision({ providerId, revisionId })
    }
  })
}

async function selectedRevisions() {
  const providers = await prisma.authenticationProvider.findMany({
    include: { selectedRevision: true },
    orderBy: { key: "asc" },
  })
  return providers.map((provider) => ({
    configurationDigest: provider.selectedRevision?.configurationDigest,
    key: provider.key,
    revision: provider.selectedRevision?.revision,
  }))
}

async function createProviderSession(
  providerKey: "entra" | "github",
  digest: string,
  options: {
    administrator?: boolean
    assignmentSubject?: string
    includeProviderRevision?: boolean
    subject?: string
  } = {},
) {
  const provider = await prisma.authenticationProvider.findUniqueOrThrow({
    include: { selectedRevision: true },
    where: { key: providerKey },
  })
  const userId = randomUUID()
  const externalIdentityId = randomUUID()
  const membershipId = randomUUID()
  await prisma.$transaction(async (transaction) => {
    await transaction.user.create({ data: { id: userId } })
    await transaction.externalIdentity.create({
      data: {
        id: externalIdentityId,
        issuer: providerKey === "github" ? "https://github.com" : issuer,
        provider: providerKey,
        subject: options.subject ?? `${providerKey}-subject`,
        userId,
      },
    })
    await transaction.membership.create({ data: { id: membershipId, userId } })
    await transaction.membershipAssignment.create({
      data: {
        externalIdentityId,
        id: randomUUID(),
        membershipId,
        providerAssignmentSubject: options.assignmentSubject ?? randomUUID(),
        providerRevisionId: provider.selectedRevision!.id,
        role: "MEMBER",
        source: "AUTHENTICATION_PROVIDER",
      },
    })
    if (options.administrator) {
      await transaction.membershipAssignment.create({
        data: {
          externalIdentityId,
          membershipId,
          role: "ADMINISTRATOR",
          source: "BOOTSTRAP",
        },
      })
    }
    await transaction.hubSession.create({
      data: {
        digest,
        externalIdentityId,
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        id: randomUUID(),
        membershipId,
        ...(options.includeProviderRevision
          ? { providerRevisionId: provider.selectedRevision!.id }
          : {}),
        revocationRevision: 0,
      },
    })
  })
  return { externalIdentityId, membershipId, userId }
}

describe("createAuthenticationRouteDependencies()", () => {
  it.each([
    { installation: "is already configured", startWithoutGitHub: false },
    { installation: "is configured after an earlier startup", startWithoutGitHub: true },
  ])(
    "requires GitHub members to reauthenticate once when the installation $installation",
    async ({ startWithoutGitHub }) => {
      const configured = environment({ entra: true, github: true })
      const repository = {
        defaultBranch: "main",
        githubRepositoryId: 1001,
        nameWithOwner: "team/accessible",
      }
      const request = vi.fn<typeof fetch>((input) => {
        const url = input instanceof Request ? input.url : input.toString()
        if (url.startsWith(`${issuer}/.well-known/`)) return Promise.resolve(discovery())
        if (url === "https://github.com/login/oauth/access_token") {
          return Promise.resolve(
            Response.json({ access_token: "test-user-token", token_type: "bearer" }),
          )
        }
        if (url === "https://api.github.com/user") {
          return Promise.resolve(Response.json({ id: 101, login: "github-member" }))
        }
        if (url.startsWith("https://api.github.com/user/installations/456/repositories?")) {
          return Promise.resolve(
            Response.json({
              total_count: 1,
              repositories: [
                {
                  default_branch: repository.defaultBranch,
                  full_name: repository.nameWithOwner,
                  id: repository.githubRepositoryId,
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
        }
        throw new Error(`Unexpected provider request: ${url}`)
      })
      if (startWithoutGitHub) {
        const initiallyConfigured = Object.fromEntries(
          Object.entries(configured).filter(([key]) => !key.startsWith("GITHUB_")),
        )
        await createAuthenticationRouteDependencies(initiallyConfigured, request)
      }
      await seedConfiguredProviders(configured)

      const memberDigest = "1".repeat(64)
      const member = await createProviderSession("github", memberDigest, {
        assignmentSubject: "github_repository_access",
        includeProviderRevision: true,
        subject: "101",
      })
      const olderMemberDigest = "2".repeat(64)
      const olderMemberSession = await prisma.hubSession.create({
        data: {
          digest: olderMemberDigest,
          expiresAt: new Date("2099-01-01T00:00:00Z"),
          externalIdentityId: member.externalIdentityId,
          membershipId: member.membershipId,
          revocationRevision: 0,
        },
      })
      await prisma.membershipAssignment.create({
        data: {
          externalIdentityId: member.externalIdentityId,
          lifecycle: "REVOKED",
          membershipId: member.membershipId,
          role: "ADMINISTRATOR",
          source: "HUB_ADMINISTRATOR",
        },
      })
      const administratorDigest = "3".repeat(64)
      const administrator = await createProviderSession("github", administratorDigest, {
        administrator: true,
        includeProviderRevision: true,
        subject: "102",
      })
      const entraDigest = "4".repeat(64)
      const entraMember = await createProviderSession("entra", entraDigest, {
        includeProviderRevision: true,
      })
      const entraProvider = await prisma.authenticationProvider.findUniqueOrThrow({
        include: { selectedRevision: true },
        where: { key: "entra" },
      })
      const linkedEntraIdentity = await prisma.externalIdentity.create({
        data: {
          issuer,
          provider: "entra",
          subject: "linked-entra-member",
          userId: member.userId,
        },
      })
      await prisma.membershipAssignment.create({
        data: {
          externalIdentityId: linkedEntraIdentity.id,
          membershipId: member.membershipId,
          providerAssignmentSubject: randomUUID(),
          providerRevisionId: entraProvider.selectedRevision!.id,
          role: "MEMBER",
          source: "AUTHENTICATION_PROVIDER",
        },
      })
      const linkedEntraDigest = "5".repeat(64)
      await prisma.hubSession.create({
        data: {
          digest: linkedEntraDigest,
          expiresAt: new Date("2099-01-01T00:00:00Z"),
          externalIdentityId: linkedEntraIdentity.id,
          membershipId: member.membershipId,
          providerRevisionId: entraProvider.selectedRevision!.id,
          revocationRevision: 0,
        },
      })
      await expect(
        restoreHubSession(memberDigest, {
          runTransaction: (operation) => runSessionRestoreTransaction(prisma, operation),
        }),
      ).resolves.toMatchObject({ membershipId: member.membershipId, role: "MEMBER" })
      const memberSession = await prisma.hubSession.findUniqueOrThrow({
        select: { id: true },
        where: { digest: memberDigest },
      })

      const dependencies = await createAuthenticationRouteDependencies(configured, request)

      for (const digest of [memberDigest, olderMemberDigest]) {
        await expect(dependencies.currentSession.restore(digest)).resolves.toBeNull()
        await expect(
          prisma.hubSession.findUniqueOrThrow({
            select: { endedAt: true },
            where: { digest },
          }),
        ).resolves.toHaveProperty("endedAt", expect.any(Date))
      }
      await expect(dependencies.currentSession.restore(administratorDigest)).resolves.toMatchObject(
        {
          membershipId: administrator.membershipId,
          role: "ADMINISTRATOR",
          sessionProvider: "github",
        },
      )
      await expect(dependencies.currentSession.restore(entraDigest)).resolves.toMatchObject({
        membershipId: entraMember.membershipId,
        role: "MEMBER",
        sessionProvider: "entra",
      })
      await expect(dependencies.currentSession.restore(linkedEntraDigest)).resolves.toMatchObject({
        membershipId: member.membershipId,
        role: "MEMBER",
        sessionProvider: "entra",
      })

      const context = createGitHubAuthenticationContext(configured, request)
      const provider = {
        configurationDigest: context.configurationDigest,
        revision: context.providerRevision,
      }
      await syncGitHubInstallationRepositories(
        prisma,
        () => Promise.resolve([repository]),
        provider,
      )
      expect(
        await prisma.repositoryAccessGrant.count({ where: { membershipId: member.membershipId } }),
      ).toBe(0)
      const started = await dependencies.github!.signIn.start()
      const state = new URL(started.authorizationUrl).searchParams.get("state")
      if (!state) throw new Error("Missing GitHub sign-in state.")
      const completed = await dependencies.github!.callback.complete({
        browserBinding: started.browserBinding,
        code: "test-code",
        state,
      })
      const freshDigest = "6".repeat(64)
      const authorityLock = new Client({ connectionString: getDatabaseUrl() })
      await authorityLock.connect()
      await authorityLock.query("SELECT pg_advisory_lock_shared(1919242348, 3)")
      const admission = dependencies.github!.callback.admit({
        proof: completed.proof,
        providerAssignment: completed.providerAssignment,
        repositoryAccess: completed.repositoryAccess,
        sessionDigest: freshDigest,
        sessionId: randomUUID(),
      })
      try {
        await expect(admission).rejects.toBeInstanceOf(AdmissionUnavailableError)
      } finally {
        await authorityLock.query("SELECT pg_advisory_unlock_shared(1919242348, 3)")
        await authorityLock.end()
      }
      const admitted = await dependencies.github!.callback.admit({
        proof: completed.proof,
        providerAssignment: completed.providerAssignment,
        repositoryAccess: completed.repositoryAccess,
        sessionDigest: freshDigest,
        sessionId: randomUUID(),
      })
      expect(admitted.expiresAt).toBeInstanceOf(Date)
      const connected = await prisma.repository.findUniqueOrThrow({
        where: { githubRepositoryId: 1001n },
      })
      await expect(
        prisma.repositoryAccessGrant.findMany({
          select: { repositoryId: true },
          where: { membershipId: member.membershipId },
        }),
      ).resolves.toEqual([{ repositoryId: connected.id }])

      await syncGitHubInstallationRepositories(
        prisma,
        () =>
          Promise.resolve([
            repository,
            { defaultBranch: "main", githubRepositoryId: 1002, nameWithOwner: "team/other" },
          ]),
        provider,
      )
      const restarted = await createAuthenticationRouteDependencies(configured, request)

      await expect(restarted.currentSession.restore(freshDigest)).resolves.toMatchObject({
        membershipId: member.membershipId,
        role: "MEMBER",
        sessionProvider: "github",
      })
      await expect(restarted.currentSession.restore(administratorDigest)).resolves.toMatchObject({
        membershipId: administrator.membershipId,
        role: "ADMINISTRATOR",
      })
      await expect(restarted.currentSession.restore(entraDigest)).resolves.toMatchObject({
        membershipId: entraMember.membershipId,
        role: "MEMBER",
      })
      await expect(
        prisma.repositoryAccessGrant.findMany({
          select: { repositoryId: true },
          where: { membershipId: member.membershipId },
        }),
      ).resolves.toEqual([{ repositoryId: connected.id }])
      const endedAudits = await prisma.securityAudit.findMany({
        select: { targetId: true },
        where: { action: "session.ended" },
      })
      expect(endedAudits.map(({ targetId }) => targetId).sort()).toEqual(
        [memberSession.id, olderMemberSession.id].sort(),
      )
    },
  )

  it("rolls back first scope activation when a session audit fails and retries on startup", async () => {
    const configured = environment({ entra: true, github: true })
    await seedConfiguredProviders(configured)
    const digest = "7".repeat(64)
    await createProviderSession("github", digest, { subject: "101" })
    const before = await selectedRevisions()

    await withFailingSecurityAudit("session.ended", () =>
      expect(
        createAuthenticationRouteDependencies(
          { ...configured, ENTRA_OIDC_PROVIDER_REVISION: "2" },
          validDiscovery,
        ),
      ).rejects.toThrow(),
    )

    expect(await selectedRevisions()).toEqual(before)
    await expect(
      prisma.hubSession.findUniqueOrThrow({ select: { endedAt: true }, where: { digest } }),
    ).resolves.toEqual({ endedAt: null })
    await expect(prisma.securityAudit.count({ where: { action: "session.ended" } })).resolves.toBe(
      0,
    )
    const dependencies = await createAuthenticationRouteDependencies(configured, validDiscovery)
    await expect(dependencies.currentSession.restore(digest)).resolves.toBeNull()
    await expect(
      prisma.hubSession.findUniqueOrThrow({ select: { endedAt: true }, where: { digest } }),
    ).resolves.toHaveProperty("endedAt", expect.any(Date))
    await expect(prisma.securityAudit.count({ where: { action: "session.ended" } })).resolves.toBe(
      1,
    )
  })

  it("does not end or audit GitHub sessions that expire after the activation transaction starts", async () => {
    await seedConfiguredProviders(environment({ entra: true, github: true }))
    const expiredDigest = "d".repeat(64)
    const activeDigest = "e".repeat(64)
    const expiredAlongsideActiveDigest = "f".repeat(64)
    const activeMember = await createProviderSession("github", activeDigest, {
      subject: "active-member",
    })
    const activeSession = await prisma.hubSession.findUniqueOrThrow({
      where: { digest: activeDigest },
      select: { id: true },
    })
    await createProviderSession("github", expiredDigest, {
      subject: "expired-member",
    })
    // The active member also has an expired session, so both query cutoffs are exercised.
    await prisma.hubSession.create({
      data: {
        digest: expiredAlongsideActiveDigest,
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        externalIdentityId: activeMember.externalIdentityId,
        membershipId: activeMember.membershipId,
        revocationRevision: 0,
      },
    })
    await prisma.$transaction(
      async (transaction) => {
        const [before] = await transaction.$queryRaw<
          Array<{ unexpiredAtStart: boolean; unexpiredNow: boolean }>
        >`
          SELECT
            bool_and("expires_at" > CURRENT_TIMESTAMP) AS "unexpiredAtStart",
            bool_and("expires_at" > clock_timestamp()) AS "unexpiredNow"
          FROM "hub_sessions"
          WHERE "digest" IN (${expiredDigest}, ${expiredAlongsideActiveDigest})
        `
        expect(before).toEqual({ unexpiredAtStart: true, unexpiredNow: true })

        // Session expiry is immutable in production; relax its guard only for this fixture.
        await transaction.$executeRaw`
          ALTER TABLE "hub_sessions" DISABLE TRIGGER "hub_sessions_protected"
        `
        await transaction.$executeRaw`
          UPDATE "hub_sessions"
          SET "expires_at" = clock_timestamp() + interval '100 milliseconds'
          WHERE "digest" IN (${expiredDigest}, ${expiredAlongsideActiveDigest})
        `
        await transaction.$executeRaw`
          ALTER TABLE "hub_sessions" ENABLE TRIGGER "hub_sessions_protected"
        `
        await transaction.$executeRaw`
          SELECT pg_sleep(
            GREATEST(
              0,
              EXTRACT(EPOCH FROM (
                (SELECT max("expires_at") FROM "hub_sessions"
                 WHERE "digest" IN (${expiredDigest}, ${expiredAlongsideActiveDigest}))
                - clock_timestamp()
              ))::float8
            ) + 0.05
          )
        `
        const [after] = await transaction.$queryRaw<
          Array<{ unexpiredAtStart: boolean; expiredNow: boolean }>
        >`
          SELECT
            bool_and("expires_at" > CURRENT_TIMESTAMP) AS "unexpiredAtStart",
            bool_and("expires_at" <= clock_timestamp()) AS "expiredNow"
          FROM "hub_sessions"
          WHERE "digest" IN (${expiredDigest}, ${expiredAlongsideActiveDigest})
        `
        expect(after).toEqual({ unexpiredAtStart: true, expiredNow: true })
        await expect(listOpenGitHubSessionMemberships(transaction)).resolves.toEqual([
          { membershipId: activeMember.membershipId },
        ])

        await activateGitHubRepositoryScoping(transaction)
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 },
    )
    await expect(
      prisma.hubSession.findMany({
        where: { digest: { in: [expiredDigest, expiredAlongsideActiveDigest] } },
        select: { digest: true, endedAt: true },
        orderBy: { digest: "asc" },
      }),
    ).resolves.toEqual([
      { digest: expiredDigest, endedAt: null },
      { digest: expiredAlongsideActiveDigest, endedAt: null },
    ])
    await expect(
      prisma.hubSession.findUniqueOrThrow({
        where: { digest: activeDigest },
        select: { endedAt: true },
      }),
    ).resolves.toHaveProperty("endedAt", expect.any(Date))
    await expect(
      prisma.securityAudit.findMany({
        where: { action: "session.ended" },
        select: { targetId: true },
      }),
    ).resolves.toEqual([{ targetId: activeSession.id }])
  }, 15_000)

  it("keeps Entra authority available when the GitHub App configuration becomes incomplete", async () => {
    const configured = environment({ entra: true, github: true })
    await createAuthenticationRouteDependencies(configured, validDiscovery)
    const entraDigest = "c".repeat(64)
    const entraSession = await createProviderSession("entra", entraDigest)

    const dependencies = await createAuthenticationRouteDependencies(
      { ...configured, GITHUB_APP_ID: "" },
      validDiscovery,
    )

    expect(dependencies.github).toBeUndefined()
    expect(dependencies.entra).toBeDefined()
    await expect(dependencies.currentSession.restore(entraDigest)).resolves.toBeNull()
    await expect(
      prisma.membershipAssignment.findFirstOrThrow({
        where: { membershipId: entraSession.membershipId, source: "AUTHENTICATION_PROVIDER" },
        select: { lifecycle: true, role: true },
      }),
    ).resolves.toEqual({ lifecycle: "ACTIVE", role: "MEMBER" })
    const attempt = await dependencies.entra!.signIn.start()
    expect(attempt.authorizationUrl).toContain(`${issuer}/oauth2/v2.0/authorize`)
    await expect(
      prisma.authenticationProvider.findMany({
        orderBy: { key: "asc" },
        select: { enabled: true, key: true },
      }),
    ).resolves.toEqual([
      { enabled: true, key: "entra" },
      { enabled: false, key: "github" },
    ])
  })

  it("binds both provider enrollment attempts to one bootstrap digest while sign-in remains unbound", async () => {
    const dependencies = await createAuthenticationRouteDependencies(
      environment({ entra: true, github: true }),
      validDiscovery,
    )

    await Promise.all([
      dependencies.github!.administratorEnrollment.start(),
      dependencies.github!.signIn.start(),
      dependencies.entra!.administratorEnrollment.start(),
      dependencies.entra!.signIn.start(),
    ])

    const providers = await prisma.authenticationProvider.findMany({
      include: { selectedRevision: true },
      orderBy: { key: "asc" },
    })
    const attempts = await prisma.authorizationAttempt.findMany({
      orderBy: [{ providerRevisionId: "asc" }, { purpose: "asc" }],
      select: {
        bootstrapSecretDigest: true,
        providerRevisionId: true,
        purpose: true,
      },
    })
    const providerKeyByRevision = new Map(
      providers.map((provider) => [provider.selectedRevision!.id, provider.key]),
    )
    const evidence = attempts.map((attempt) => ({
      bootstrapSecretDigest: attempt.bootstrapSecretDigest,
      provider: providerKeyByRevision.get(attempt.providerRevisionId),
      purpose: attempt.purpose,
    }))
    const enrollmentDigests = evidence
      .filter(({ purpose }) => purpose === "ADMIN_ENROLLMENT")
      .map(({ bootstrapSecretDigest }) => bootstrapSecretDigest)

    expect(evidence).toContainEqual({
      bootstrapSecretDigest: null,
      provider: "github",
      purpose: "SIGN_IN",
    })
    expect(evidence).toContainEqual({
      bootstrapSecretDigest: null,
      provider: "entra",
      purpose: "SIGN_IN",
    })
    expect(
      evidence.some(
        ({ bootstrapSecretDigest, provider, purpose }) =>
          provider === "github" &&
          purpose === "ADMIN_ENROLLMENT" &&
          /^[0-9a-f]{64}$/.test(bootstrapSecretDigest ?? ""),
      ),
    ).toBe(true)
    expect(
      evidence.some(
        ({ bootstrapSecretDigest, provider, purpose }) =>
          provider === "entra" &&
          purpose === "ADMIN_ENROLLMENT" &&
          /^[0-9a-f]{64}$/.test(bootstrapSecretDigest ?? ""),
      ),
    ).toBe(true)
    expect(new Set(enrollmentDigests).size).toBe(1)
  })

  it("rolls back every provider selection when the later reconciliation fails", async () => {
    await createAuthenticationRouteDependencies(
      environment({ entra: true, github: true }),
      validDiscovery,
    )
    const before = await selectedRevisions()

    await expect(
      createAuthenticationRouteDependencies(
        environment({
          entra: true,
          entraRevision: 2,
          github: true,
          githubClientId: "same-revision-drift",
        }),
        validDiscovery,
      ),
    ).rejects.toThrow()

    expect(await selectedRevisions()).toEqual(before)
    await expect(
      prisma.securityAudit.findMany({
        orderBy: { createdAt: "asc" },
        where: { action: "identity.provider_revision.denied" },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        action: "identity.provider_revision.denied",
        context: {
          provider: "github",
          reason: "same_revision_drift",
          revision: 1,
        },
        outcome: "DENIED",
      }),
    ])
  })

  it("converges two-provider concurrent startup without partial selections", async () => {
    await createAuthenticationRouteDependencies(
      environment({ entra: true, github: true }),
      validDiscovery,
    )

    await expect(
      Promise.all([
        createAuthenticationRouteDependencies(
          environment({
            entra: true,
            entraRevision: 2,
            github: true,
            githubRevision: 2,
          }),
          validDiscovery,
        ),
        createAuthenticationRouteDependencies(
          environment({
            entra: true,
            entraRevision: 2,
            github: true,
            githubRevision: 2,
          }),
          validDiscovery,
        ),
      ]),
    ).resolves.toHaveLength(2)

    expect(await selectedRevisions()).toEqual([
      expect.objectContaining({ key: "entra", revision: 2 }),
      expect.objectContaining({ key: "github", revision: 2 }),
    ])
    await expect(
      prisma.securityAudit.count({
        where: { action: "identity.authentication_providers.reconcile_failed" },
      }),
    ).resolves.toBe(0)
  })

  it.each([
    ["timeout", () => Promise.reject(new Error("timeout with entra-secret and private cause"))],
    ["issuer mismatch", () => Promise.resolve(discovery({ issuer: `${issuer}/different` }))],
    ["schema failure", () => Promise.resolve(discovery({ token_endpoint: 42 }))],
  ] as const)(
    "audits a sanitized %s discovery preflight failure without changing selections",
    async (_name, response) => {
      await createAuthenticationRouteDependencies(
        environment({ entra: true, github: true }),
        validDiscovery,
      )
      const before = await selectedRevisions()
      const request = vi.fn<typeof fetch>(response)

      const error = await createAuthenticationRouteDependencies(
        environment({ entra: true, entraRevision: 2, github: true }),
        request,
      ).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(Error)
      expect(await selectedRevisions()).toEqual(before)
      const audits = await prisma.securityAudit.findMany({
        orderBy: { createdAt: "asc" },
        where: { outcome: "FAILURE" },
      })
      expect(audits).toEqual([
        expect.objectContaining({
          action: "identity.provider_revision.validation_failed",
          context: {
            provider: "entra",
            reason: "validation_failed",
            revision: 2,
          },
        }),
      ])
      expect(JSON.stringify(audits)).not.toMatch(/entra-secret|private cause|token_endpoint/)
    },
  )

  it.each([
    {
      configured: { github: true },
      removed: "entra" as const,
      retained: "github" as const,
    },
    {
      configured: { entra: true },
      removed: "github" as const,
      retained: "entra" as const,
    },
  ])(
    "invalidates old $removed and $retained sessions while keeping $retained authentication available",
    async ({ configured, removed, retained }) => {
      await createAuthenticationRouteDependencies(
        environment({ entra: true, github: true }),
        validDiscovery,
      )
      const removedDigest = "a".repeat(64)
      const retainedDigest = "b".repeat(64)
      await createProviderSession(removed, removedDigest)
      await createProviderSession(retained, retainedDigest)

      const dependencies = await createAuthenticationRouteDependencies(
        environment(configured),
        validDiscovery,
      )

      await expect(dependencies.currentSession.restore(removedDigest)).resolves.toBeNull()
      await expect(dependencies.currentSession.restore(retainedDigest)).resolves.toBeNull()
      const retainedProvider = dependencies[retained]
      expect(retainedProvider).toBeDefined()
      const retainedAttempt = await retainedProvider!.signIn.start()
      expect(retainedAttempt.authorizationUrl).toContain(
        retained === "github"
          ? "github.com/login/oauth/authorize"
          : `${issuer}/oauth2/v2.0/authorize`,
      )
      await expect(
        prisma.securityAudit.findMany({
          orderBy: { action: "asc" },
          select: { action: true, context: true },
          where: {
            action: {
              in: ["identity.authentication_provider.disabled", "session.revocation.advanced"],
            },
          },
        }),
      ).resolves.toEqual([
        {
          action: "identity.authentication_provider.disabled",
          context: { provider: removed },
        },
        {
          action: "session.revocation.advanced",
          context: { reason: "provider_removed", revision: 1 },
        },
      ])
    },
  )

  it("denies same-revision reactivation without changing disabled provider state", async () => {
    await createAuthenticationRouteDependencies(
      environment({ entra: true, github: true }),
      validDiscovery,
    )
    await createAuthenticationRouteDependencies(environment({ github: true }), validDiscovery)
    const disabled = await prisma.authenticationProvider.findUniqueOrThrow({
      where: { key: "entra" },
      select: {
        enabled: true,
        selectedRevisionId: true,
        revisions: {
          orderBy: { revision: "asc" },
          select: { id: true, revision: true },
        },
      },
    })
    const attemptCount = await prisma.authorizationAttempt.count()
    const sessionCount = await prisma.hubSession.count()

    await expect(
      createAuthenticationRouteDependencies(
        environment({ entra: true, github: true }),
        validDiscovery,
      ),
    ).rejects.toThrow()

    await expect(
      prisma.authenticationProvider.findUniqueOrThrow({
        where: { key: "entra" },
        select: {
          enabled: true,
          selectedRevisionId: true,
          revisions: {
            orderBy: { revision: "asc" },
            select: { id: true, revision: true },
          },
        },
      }),
    ).resolves.toEqual(disabled)
    await expect(prisma.authorizationAttempt.count()).resolves.toBe(attemptCount)
    await expect(prisma.hubSession.count()).resolves.toBe(sessionCount)
    await expect(
      prisma.securityAudit.findMany({
        orderBy: { createdAt: "desc" },
        select: { action: true, context: true, outcome: true },
        take: 1,
      }),
    ).resolves.toEqual([
      {
        action: "identity.provider_revision.denied",
        context: {
          provider: "entra",
          reason: "reactivation_requires_revision",
          revision: 1,
        },
        outcome: "DENIED",
      },
    ])
  })

  it("disables every provider once and requires fresh sign-in when identical configuration returns", async () => {
    const original = await createAuthenticationRouteDependencies(
      environment({ entra: true, github: true }),
      validDiscovery,
    )
    const entraDigest = "f".repeat(64)
    const githubDigest = "0".repeat(64)
    await createProviderSession("entra", entraDigest)
    await createProviderSession("github", githubDigest)
    const selectedBefore = await prisma.authenticationProvider.findMany({
      orderBy: { key: "asc" },
      select: { key: true, selectedRevisionId: true },
    })

    await disableAuthenticationProviders()

    await expect(
      prisma.authenticationProvider.findMany({
        orderBy: { key: "asc" },
        select: { enabled: true, key: true },
      }),
    ).resolves.toEqual([
      { enabled: false, key: "entra" },
      { enabled: false, key: "github" },
    ])
    await expect(
      prisma.authenticationProvider.findMany({
        orderBy: { key: "asc" },
        select: { key: true, selectedRevisionId: true },
      }),
    ).resolves.toEqual([
      { key: "entra", selectedRevisionId: null },
      { key: "github", selectedRevisionId: null },
    ])
    await expect(
      getSelectedProviderRevision("entra", {
        findAuthenticationProvider: (key) => findAuthenticationProvider(prisma, key),
      }),
    ).rejects.toThrow("does not have a selected revision")
    await expect(
      prisma.sessionRevocationState.findUniqueOrThrow({
        select: { revision: true },
        where: { key: "global" },
      }),
    ).resolves.toEqual({ revision: 1 })
    await expect(original.currentSession.restore(entraDigest)).resolves.toBeNull()
    await expect(original.currentSession.restore(githubDigest)).resolves.toBeNull()
    await expect(original.entra!.signIn.start()).rejects.toThrow()
    await expect(original.github!.signIn.start()).rejects.toThrow()

    await disableAuthenticationProviders()

    await expect(
      prisma.sessionRevocationState.findUniqueOrThrow({
        select: { revision: true },
        where: { key: "global" },
      }),
    ).resolves.toEqual({ revision: 1 })
    await expect(
      prisma.securityAudit.count({ where: { action: "session.revocation.advanced" } }),
    ).resolves.toBe(1)
    await expect(
      prisma.securityAudit.count({
        where: { action: "identity.authentication_provider.disabled" },
      }),
    ).resolves.toBe(2)

    const reenabled = await createAuthenticationRouteDependencies(
      environment({ entra: true, entraRevision: 2, github: true, githubRevision: 2 }),
      validDiscovery,
    )

    const selectedAfter = await prisma.authenticationProvider.findMany({
      orderBy: { key: "asc" },
      select: { key: true, selectedRevisionId: true },
    })
    expect(selectedAfter.map(({ key }) => key)).toEqual(selectedBefore.map(({ key }) => key))
    expect(selectedAfter[0]!.selectedRevisionId).not.toBe(selectedBefore[0]!.selectedRevisionId)
    expect(selectedAfter[1]!.selectedRevisionId).not.toBe(selectedBefore[1]!.selectedRevisionId)
    await expect(reenabled.currentSession.restore(entraDigest)).resolves.toBeNull()
    await expect(reenabled.currentSession.restore(githubDigest)).resolves.toBeNull()
    const entraAttempt = await reenabled.entra!.signIn.start()
    const githubAttempt = await reenabled.github!.signIn.start()
    expect(entraAttempt.authorizationUrl).toContain(`${issuer}/oauth2/v2.0/authorize`)
    expect(githubAttempt.authorizationUrl).toContain("github.com/login/oauth/authorize")
    await expect(
      prisma.sessionRevocationState.findUniqueOrThrow({
        select: { revision: true },
        where: { key: "global" },
      }),
    ).resolves.toEqual({ revision: 1 })
  })

  it("keeps both providers active when both remain configured", async () => {
    await createAuthenticationRouteDependencies(
      environment({ entra: true, github: true }),
      validDiscovery,
    )
    const entraDigest = "d".repeat(64)
    const githubDigest = "e".repeat(64)
    const entraSession = await createProviderSession("entra", entraDigest)
    const githubSession = await createProviderSession("github", githubDigest)

    const dependencies = await createAuthenticationRouteDependencies(
      environment({ entra: true, github: true }),
      validDiscovery,
    )

    await expect(dependencies.currentSession.restore(entraDigest)).resolves.toEqual({
      externalIdentityId: entraSession.externalIdentityId,
      membershipId: entraSession.membershipId,
      userId: entraSession.userId,
      provider: "entra",
      sessionProvider: "entra",
      login: "entra-subject",
      name: null,
      role: "MEMBER",
    })
    await expect(dependencies.currentSession.restore(githubDigest)).resolves.toEqual({
      externalIdentityId: githubSession.externalIdentityId,
      membershipId: githubSession.membershipId,
      userId: githubSession.userId,
      provider: "github",
      sessionProvider: "github",
      login: "github-subject",
      name: null,
      role: "MEMBER",
    })
  })
})
