import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createAuthenticationService } from "#server/domains/authentication/create-service"
import { createIdentityStore } from "#server/domains/identity/create-store"
import type { OidcConfiguration } from "#server/integrations/oidc/create-client/types"
import { digestSecret } from "#server/utils/digest-secret"

type IdentityStore = ReturnType<typeof createIdentityStore>

const oidcIssuer = "https://login.microsoftonline.com/a0b1c2d3-e4f5-4a67-8b9c-0d1e2f3a4b5c/v2.0"
const oidcConfiguration: OidcConfiguration = {
  issuer: oidcIssuer,
  clientId: "hub-client",
  clientSecret: "client-secret-fixture",
  clientCredentialReference: "HUB_OIDC_CLIENT_SECRET",
  callbackUrl: "https://hub.example.test/api/auth/oidc/callback",
  scopes: ["openid", "profile", "email"],
  memberRole: "Hub.User",
  administratorRole: "Hub.Administrator",
  membershipPolicy: "jit-assignment",
  enabled: true,
  providerRevision: 4,
}

async function database() {
  vi.stubGlobal("prisma", undefined)
  const { prisma } = await import("../../../integrations/prisma")
  onTestFinished(() => prisma.$disconnect())
  return { prisma, store: createIdentityStore(prisma) }
}

async function createOidcMember(store: IdentityStore, role: "member" | "administrator") {
  return store.lock(async (records) => {
    const user = await records.createUser({
      displayName: "OIDC member",
      avatarUrl: null,
    })
    const identity = await records.saveExternalIdentity({
      userId: user.id,
      provider: "oidc",
      issuer: oidcIssuer,
      subject: "immutable-subject",
      directoryObjectId: "a0e1d2c3-b4a5-4678-9abc-def012345678",
      username: "member@example.test",
      email: "member@example.test",
      displayName: "OIDC member",
      avatarUrl: null,
    })
    const provider = await records.createAuthenticationProviderRevision({
      key: "oidc",
      type: "oidc",
      enabled: true,
      revision: 4,
      issuer: oidcIssuer,
      configuration: { clientId: "hub-client" },
    })
    const membership = await records.saveMembership({
      userId: user.id,
      status: "active",
      role,
      source: "oidc-assignment",
    })
    return { identity, membership, provider, user }
  })
}

function oidcService(
  store: IdentityStore,
  providerRevisionId: string,
  role: "member" | "administrator",
  subject = "immutable-subject",
) {
  return createAuthenticationService({
    store,
    github: null,
    configuration: null,
    providerRevisionId: null,
    oidc: {
      authorizationUrl: vi.fn(),
      identify: vi.fn().mockResolvedValue({
        subject,
        directoryObjectId: "a0e1d2c3-b4a5-4678-9abc-def012345678",
        username: "member@example.test",
        email: "member@example.test",
        displayName: "OIDC member",
        avatarUrl: null,
        role,
      }),
    },
    oidcConfiguration,
    oidcProviderRevisionId: providerRevisionId,
    provider: "oidc",
    admissionPolicy: { name: "hub-managed", admit: vi.fn().mockResolvedValue(false) },
  })
}

async function createAdministrator(store: IdentityStore) {
  return store.lock(async (records) => {
    const user = await records.createUser({
      displayName: "Synthetic administrator",
      avatarUrl: null,
    })
    const identity = await records.saveExternalIdentity({
      userId: user.id,
      provider: "github",
      issuer: "https://github.com",
      subject: "42",
      username: "octocat",
      displayName: "Synthetic administrator",
      avatarUrl: null,
    })
    const provider = await records.createAuthenticationProviderRevision({
      key: "github",
      type: "github",
      enabled: true,
      revision: 1,
      issuer: "https://github.com",
      configuration: { clientId: "github-client" },
    })
    await records.saveMembership({
      userId: user.id,
      status: "active",
      role: "administrator",
      source: "manual",
    })
    return { identity, provider, user }
  })
}

async function createSession(
  store: IdentityStore,
  graph: Awaited<ReturnType<typeof createAdministrator>>,
  token: string,
) {
  const authorizedAt = new Date()
  return store.lock((records) =>
    records.createSession({
      userId: graph.user.id,
      externalIdentityId: graph.identity.id,
      authenticationProviderRevisionId: graph.provider.id,
      tokenDigest: digestSecret(token),
      signedInAt: authorizedAt,
      freshAuthorizedAt: authorizedAt,
    }),
  )
}

describe("createAuthenticationService() database behavior", () => {
  it("requires a fresh eligible baseline only for synchronized sessions", async () => {
    const { prisma, store } = await database()
    const graph = await createAdministrator(store)
    await createSession(store, graph, "session-token")
    await prisma.installationMembership.update({
      where: { userId: graph.user.id },
      data: { role: "member", source: "synchronized" },
    })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
        admissionEnabled: true,
      },
    })
    const baseline = await prisma.gitHubSynchronizedAccess.create({
      data: {
        repositorySourceId: source.id,
        userId: graph.user.id,
        rawPermission: "read",
        mappedPrototypeRole: "viewer",
        admissionEligible: true,
        lastConfirmedAt: new Date(),
      },
    })
    const service = createAuthenticationService({
      store,
      github: null,
      configuration: null,
      providerRevisionId: null,
      admissionPolicy: { name: "hub-managed", admit: () => Promise.resolve(null) },
    })

    await expect(service.current("session-token")).resolves.toMatchObject({
      userId: graph.user.id,
      membership: { source: "synchronized", status: "active" },
    })

    await prisma.gitHubSynchronizedAccess.update({
      where: { id: baseline.id },
      data: {
        admissionEligible: false,
        mappedPrototypeRole: null,
        rawPermission: "none",
        status: "removed",
      },
    })

    await expect(service.current("session-token")).rejects.toMatchObject({
      status: 401,
      code: "membership_inactive",
    })

    await prisma.installationMembership.update({
      where: { userId: graph.user.id },
      data: { source: "manual" },
    })
    await expect(service.current("session-token")).resolves.toMatchObject({
      userId: graph.user.id,
      membership: { source: "manual", status: "active" },
    })
  })

  it.each(["suspended", "removed"] as const)(
    "does not reactivate a manually %s membership when synchronized admission succeeds",
    async (status) => {
      const { prisma, store } = await database()
      const graph = await createAdministrator(store)
      const now = new Date()
      await store.lock(async (records) => {
        await records.saveMembership({
          userId: graph.user.id,
          status,
          role: "member",
          source: "manual",
          suspendedAt: status === "suspended" ? now : null,
          removedAt: status === "removed" ? now : null,
        })
        await records.createAuthorizationAttempt({
          authenticationProviderRevisionId: graph.provider.id,
          originatingSessionId: null,
          stateDigest: digestSecret("state"),
          browserDigest: digestSecret("browser-token"),
          pkceVerifier: "pkce-verifier",
          nonce: null,
          purpose: "sign-in",
          expiresAt: new Date(now.getTime() + 60_000),
        })
      })
      const saveBaseline = vi.fn()
      const service = createAuthenticationService({
        store,
        github: {
          authorizationUrl: vi.fn(),
          identify: vi.fn().mockResolvedValue({
            subject: graph.identity.subject,
            username: "octocat",
            displayName: "Synthetic administrator",
            avatarUrl: null,
          }),
        },
        configuration: {
          clientId: "github-client",
          clientSecret: "github-client-secret-fixture",
          callbackUrl: "https://hub.example/api/auth/github/callback",
          issuer: "https://github.com",
        },
        providerRevisionId: graph.provider.id,
        admissionPolicy: {
          name: "github-synchronized",
          admit: vi.fn().mockResolvedValue({
            repositorySourceId: "00000000-0000-0000-0000-000000000001",
            sourceGeneration: 3,
            subject: graph.identity.subject,
            admissionGeneration: 4,
            persist: true,
            rawPermission: "read",
            admissionEligible: true,
            prototypeRole: "viewer",
            confirmedAt: now,
          }),
          saveBaseline,
        },
        now: () => now,
      })

      await expect(service.complete("code", "state", "browser-token")).rejects.toMatchObject({
        status: 403,
        code: "admission_denied",
      })
      expect(
        await prisma.installationMembership.findUnique({ where: { userId: graph.user.id } }),
      ).toMatchObject({ source: "manual", status })
      expect(await prisma.session.count({ where: { userId: graph.user.id } })).toBe(0)
      expect(saveBaseline).not.toHaveBeenCalled()
    },
  )

  it("commits an admission-policy failure audit before returning the provider error", async () => {
    const { prisma, store } = await database()
    const graph = await createAdministrator(store)
    const now = new Date()
    await prisma.installationMembership.update({
      where: { userId: graph.user.id },
      data: { role: "member", source: "synchronized" },
    })
    await store.lock((records) =>
      records.createAuthorizationAttempt({
        authenticationProviderRevisionId: graph.provider.id,
        originatingSessionId: null,
        stateDigest: digestSecret("state"),
        browserDigest: digestSecret("browser-token"),
        pkceVerifier: "pkce-verifier",
        nonce: null,
        purpose: "sign-in",
        expiresAt: new Date(now.getTime() + 60_000),
      }),
    )
    const service = createAuthenticationService({
      store,
      github: {
        authorizationUrl: vi.fn(),
        identify: vi.fn().mockResolvedValue({
          subject: graph.identity.subject,
          username: "octocat",
          displayName: "Synthetic administrator",
          avatarUrl: null,
        }),
      },
      configuration: {
        clientId: "github-client",
        clientSecret: "github-client-secret-fixture",
        callbackUrl: "https://hub.example/api/auth/github/callback",
        issuer: "https://github.com",
      },
      providerRevisionId: graph.provider.id,
      admissionPolicy: {
        name: "github-synchronized",
        admit: vi.fn().mockRejectedValue(
          Object.assign(new Error("GitHub authorization changed."), {
            status: 409,
            code: "github_authorization_changed",
          }),
        ),
      },
      now: () => now,
    })

    await expect(service.complete("code", "state", "browser-token")).rejects.toMatchObject({
      status: 503,
      code: "source_integration_unavailable",
    })
    expect(
      await prisma.securityAudit.findFirst({
        where: { event: "authentication.admission_failed" },
      }),
    ).toMatchObject({
      outcome: "failed",
      actorUserId: graph.user.id,
      authenticationProviderRevisionId: graph.provider.id,
      context: { reason: "source_integration_unavailable" },
    })
    expect(await prisma.session.count({ where: { userId: graph.user.id } })).toBe(0)
  })

  it("rolls back generation, session deletion, and audit together when revocation fails", async () => {
    const { store } = await database()
    const graph = await createAdministrator(store)
    const session = await createSession(store, graph, "rollback-token")

    await expect(
      store.lock(async (records) => {
        await records.advanceSessionGeneration()
        await records.deleteSessions()
        await records.audit({
          event: "session.revoke_all",
          actorUserId: graph.user.id,
          sessionId: session.id,
          authenticationProviderRevisionId: graph.provider.id,
        })
        throw new Error("revocation failed")
      }),
    ).rejects.toThrow("revocation failed")

    expect(await store.read.identityStoreState()).toEqual({ sessionGeneration: 0 })
    expect(await store.read.session(digestSecret("rollback-token"))).toMatchObject({
      id: session.id,
    })
    expect(await store.read.audits()).toEqual([])
  })

  it("serializes concurrent revoke-all requests so generation advances exactly once", async () => {
    const { store } = await database()
    const graph = await createAdministrator(store)
    await createSession(store, graph, "administrator-token")
    await createSession(store, graph, "other-token")
    const service = createAuthenticationService({
      store,
      github: null,
      configuration: null,
      providerRevisionId: null,
      admissionPolicy: { name: "hub-managed", admit: () => Promise.resolve("legacy") },
    })

    const results = await Promise.allSettled([
      service.revokeAll("administrator-token"),
      service.revokeAll("administrator-token"),
    ])

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1)
    expect(await store.read.identityStoreState()).toEqual({ sessionGeneration: 1 })
    expect(await store.read.session(digestSecret("administrator-token"))).toBeNull()
    expect(await store.read.session(digestSecret("other-token"))).toBeNull()
    expect(await store.read.audits()).toEqual([
      expect.objectContaining({
        event: "session.revoke_all",
        actorUserId: graph.user.id,
      }),
    ])
  })

  it("rolls back a new OIDC assignment when its activation audit cannot be written", async () => {
    const { prisma, store } = await database()
    const provider = await store.lock((records) =>
      records.createAuthenticationProviderRevision({
        key: "oidc",
        type: "oidc",
        enabled: true,
        revision: 4,
        issuer: oidcIssuer,
        configuration: { clientId: "hub-client" },
      }),
    )
    await store.lock((records) =>
      records.createAuthorizationAttempt({
        authenticationProviderRevisionId: provider.id,
        originatingSessionId: null,
        stateDigest: digestSecret("new-assignment-state"),
        browserDigest: digestSecret("browser-token"),
        pkceVerifier: "pkce-verifier",
        nonce: "nonce",
        purpose: "sign-in",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    )

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "security_audits"
      ADD CONSTRAINT "test_reject_oidc_assignment_activation"
      CHECK ("event" <> 'membership.oidc_assignment.activate')
    `)
    try {
      await expect(
        oidcService(store, provider.id, "member").complete(
          "provider-code",
          "new-assignment-state",
          "browser-token",
        ),
      ).rejects.toThrow()

      expect(await prisma.user.count()).toBe(0)
      expect(await prisma.externalIdentity.count()).toBe(0)
      expect(await prisma.installationMembership.count()).toBe(0)
      expect(await prisma.session.count()).toBe(0)
      expect(await store.read.audits()).toEqual([])
    } finally {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "security_audits"
        DROP CONSTRAINT IF EXISTS "test_reject_oidc_assignment_activation"
      `)
    }
  })

  it("commits a verification role-change denial before returning the error", async () => {
    const { prisma, store } = await database()
    const graph = await createOidcMember(store, "administrator")
    const signedInAt = new Date()
    const session = await store.lock((records) =>
      records.createSession({
        userId: graph.user.id,
        externalIdentityId: graph.identity.id,
        authenticationProviderRevisionId: graph.provider.id,
        tokenDigest: digestSecret("session-token"),
        signedInAt,
        freshAuthorizedAt: null,
      }),
    )
    await store.lock((records) =>
      records.createAuthorizationAttempt({
        authenticationProviderRevisionId: graph.provider.id,
        originatingSessionId: session.id,
        stateDigest: digestSecret("verify-state"),
        browserDigest: digestSecret("browser-token"),
        pkceVerifier: "pkce-verifier",
        nonce: "nonce",
        purpose: "verify",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    )

    await expect(
      oidcService(store, graph.provider.id, "member").complete(
        "provider-code",
        "verify-state",
        "browser-token",
      ),
    ).rejects.toMatchObject({ status: 403, code: "provider_role_changed" })

    expect(await prisma.session.findUnique({ where: { id: session.id } })).toMatchObject({
      freshAuthorizedAt: null,
    })
    expect(await store.read.audits()).toEqual([
      expect.objectContaining({
        event: "session.verify",
        outcome: "denied",
        actorUserId: graph.user.id,
        sessionId: session.id,
        targetMembershipId: graph.membership.id,
        context: { reason: "provider_role_changed" },
      }),
    ])
  })

  it("migrates a changed provider subject without duplicating the existing identity graph", async () => {
    const { prisma, store } = await database()
    const graph = await createOidcMember(store, "member")
    await store.lock((records) =>
      records.createAuthorizationAttempt({
        authenticationProviderRevisionId: graph.provider.id,
        originatingSessionId: null,
        stateDigest: digestSecret("changed-subject-state"),
        browserDigest: digestSecret("browser-token"),
        pkceVerifier: "pkce-verifier",
        nonce: "nonce",
        purpose: "sign-in",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    )

    const result = await oidcService(
      store,
      graph.provider.id,
      "member",
      "replacement-subject",
    ).complete("provider-code", "changed-subject-state", "browser-token")

    expect(result.purpose).toBe("sign-in")
    expect(result.sessionToken).toEqual(expect.any(String))
    expect(await prisma.user.count()).toBe(1)
    expect(await prisma.externalIdentity.count()).toBe(1)
    expect(await prisma.installationMembership.count()).toBe(1)
    expect(
      await prisma.externalIdentity.findUnique({ where: { id: graph.identity.id } }),
    ).toMatchObject({
      userId: graph.user.id,
      subject: "replacement-subject",
      directoryObjectId: graph.identity.directoryObjectId,
    })
    expect(
      await prisma.installationMembership.findUnique({ where: { id: graph.membership.id } }),
    ).toMatchObject({ userId: graph.user.id, status: "active", role: "member" })
    expect(await prisma.session.findFirst({ where: { userId: graph.user.id } })).toMatchObject({
      externalIdentityId: graph.identity.id,
      authenticationProviderRevisionId: graph.provider.id,
    })
    expect(await store.read.audits()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "external_identity.subject_migrate",
          outcome: "succeeded",
          actorUserId: graph.user.id,
          context: { source: "directory_object_id" },
        }),
        expect.objectContaining({
          event: "session.sign_in",
          outcome: "succeeded",
          actorUserId: graph.user.id,
        }),
      ]),
    )
  })

  it("commits a provider role refresh and its supported audit context together", async () => {
    const { prisma, store } = await database()
    const graph = await createOidcMember(store, "member")
    await store.lock((records) =>
      records.createAuthorizationAttempt({
        authenticationProviderRevisionId: graph.provider.id,
        originatingSessionId: null,
        stateDigest: digestSecret("sign-in-state"),
        browserDigest: digestSecret("browser-token"),
        pkceVerifier: "pkce-verifier",
        nonce: "nonce",
        purpose: "sign-in",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    )

    await expect(
      oidcService(store, graph.provider.id, "administrator").complete(
        "provider-code",
        "sign-in-state",
        "browser-token",
      ),
    ).resolves.toMatchObject({ purpose: "sign-in" })

    expect(
      await prisma.installationMembership.findUnique({ where: { id: graph.membership.id } }),
    ).toMatchObject({ role: "administrator", source: "oidc-assignment" })
    expect(await prisma.session.count({ where: { userId: graph.user.id } })).toBe(1)
    const audits = await store.read.audits()
    expect(audits).toHaveLength(2)
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "membership.provider_role.refresh",
          outcome: "succeeded",
          actorUserId: graph.user.id,
          targetMembershipId: graph.membership.id,
          context: { reason: "role_administrator" },
        }),
        expect.objectContaining({
          event: "session.sign_in",
          outcome: "succeeded",
          actorUserId: graph.user.id,
        }),
      ]),
    )
  })
})
