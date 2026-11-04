import { randomBytes, randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { prisma } from "../../../../integrations/prisma"
import { createAuthenticationRouteDependencies } from "."

const tenantId = "11111111-1111-4111-8111-111111111111"
const entraClientId = "22222222-2222-4222-8222-222222222222"
const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`

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

async function createProviderSession(providerKey: "entra" | "github", digest: string) {
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
        subject: `${providerKey}-subject`,
        userId,
      },
    })
    await transaction.membership.create({ data: { id: membershipId, userId } })
    await transaction.membershipAssignment.create({
      data: {
        externalIdentityId,
        id: randomUUID(),
        membershipId,
        providerAssignmentSubject: randomUUID(),
        providerRevisionId: provider.selectedRevision!.id,
        role: "MEMBER",
        source: "AUTHENTICATION_PROVIDER",
      },
    })
    await transaction.hubSession.create({
      data: {
        digest,
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        id: randomUUID(),
        membershipId,
        revocationRevision: 0,
      },
    })
  })
}

describe("createAuthenticationRouteDependencies()", () => {
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
        where: { outcome: "FAILURE" },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        action: "identity.authentication_providers.reconcile_failed",
        context: {
          providerKeys: ["entra", "github"],
          reason: "transaction_error",
        },
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

  it("does not reactivate removed authority when the same provider revision is re-added", async () => {
    await createAuthenticationRouteDependencies(
      environment({ entra: true, github: true }),
      validDiscovery,
    )
    const digest = "c".repeat(64)
    await createProviderSession("entra", digest)

    const withoutEntra = await createAuthenticationRouteDependencies(
      environment({ github: true }),
      validDiscovery,
    )
    await expect(withoutEntra.currentSession.restore(digest)).resolves.toBeNull()
    await expect(
      prisma.securityAudit.count({ where: { action: "session.revocation.advanced" } }),
    ).resolves.toBe(1)
    await expect(
      prisma.securityAudit.findMany({
        select: { action: true, context: true },
        where: { action: "identity.authentication_provider.disabled" },
      }),
    ).resolves.toEqual([
      {
        action: "identity.authentication_provider.disabled",
        context: { provider: "entra" },
      },
    ])

    const readded = await createAuthenticationRouteDependencies(
      environment({ entra: true, github: true }),
      validDiscovery,
    )
    await expect(readded.currentSession.restore(digest)).resolves.toBeNull()
    await expect(
      prisma.securityAudit.count({ where: { action: "session.revocation.advanced" } }),
    ).resolves.toBe(1)
    await expect(
      prisma.securityAudit.findMany({
        select: { action: true, context: true },
        where: { action: "identity.authentication_provider.enabled" },
      }),
    ).resolves.toEqual([
      {
        action: "identity.authentication_provider.enabled",
        context: { provider: "entra" },
      },
    ])
  })

  it("keeps both providers active when both remain configured", async () => {
    await createAuthenticationRouteDependencies(
      environment({ entra: true, github: true }),
      validDiscovery,
    )
    const entraDigest = "d".repeat(64)
    const githubDigest = "e".repeat(64)
    await createProviderSession("entra", entraDigest)
    await createProviderSession("github", githubDigest)

    const dependencies = await createAuthenticationRouteDependencies(
      environment({ entra: true, github: true }),
      validDiscovery,
    )

    await expect(dependencies.currentSession.restore(entraDigest)).resolves.toEqual({
      role: "MEMBER",
    })
    await expect(dependencies.currentSession.restore(githubDigest)).resolves.toEqual({
      role: "MEMBER",
    })
  })
})
