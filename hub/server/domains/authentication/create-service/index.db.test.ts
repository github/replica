import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createAuthenticationService } from "#server/domains/authentication/create-service"
import { createIdentityStore } from "#server/domains/identity/create-store"
import { digestSecret } from "#server/utils/digest-secret"

type IdentityStore = ReturnType<typeof createIdentityStore>

async function database() {
  vi.stubGlobal("prisma", undefined)
  const { prisma } = await import("../../../integrations/prisma")
  onTestFinished(() => prisma.$disconnect())
  return { prisma, store: createIdentityStore(prisma) }
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
})
