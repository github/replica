import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createAuthenticationService } from "#server/domains/authentication/create-service"
import { createIdentityStore } from "#server/domains/identity/create-store"
import type { GitHubUserAuthClient } from "#server/integrations/github/create-user-auth-client/types"
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
      suspendedAt: null,
      removedAt: null,
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
  it.each(["bootstrap", "recovery"] as const)(
    "consumes a real %s attempt and completes administrator enrollment",
    async (purpose) => {
      const { store } = await database()
      const provider = await store.lock((records) =>
        records.createAuthenticationProviderRevision({
          key: "github",
          type: "github",
          enabled: true,
          revision: 1,
          issuer: "https://github.com",
          configuration: { clientId: "github-client" },
        }),
      )
      const github: GitHubUserAuthClient = {
        authorizationUrl: (state) => `https://github.example/authorize?state=${state}`,
        identify: vi.fn().mockResolvedValue({
          subject: `enrolled-${purpose}`,
          username: `enrolled-${purpose}`,
          displayName: `Enrolled ${purpose}`,
          avatarUrl: null,
        }),
      }
      const secret = `${purpose}-secret`
      const now = new Date()
      const service = createAuthenticationService({
        store,
        github,
        configuration: {
          clientId: "github-client",
          clientSecret: "github-client-secret-fixture",
          callbackUrl: "https://hub.example/api/auth/github/callback",
          issuer: "https://github.com",
        },
        providerRevisionId: provider.id,
        admissionPolicy: { name: "hub-managed", admit: () => Promise.resolve(false) },
        bootstrapSecret: purpose === "bootstrap" ? secret : null,
        recoverySecret: purpose === "recovery" ? secret : null,
        now: () => now,
      })

      const started = await service.start(purpose, undefined, secret)
      const state = new URL(started.authorizationUrl).searchParams.get("state")
      expect(state).toBeTruthy()

      const completed = await service.complete("one-use-code", state!, started.browserToken)

      expect(completed.purpose).toBe(purpose)
      expect(typeof completed.sessionToken).toBe("string")
      const identity = await store.read.externalIdentity(
        "github",
        "https://github.com",
        `enrolled-${purpose}`,
      )
      expect(identity).not.toBeNull()
      expect(await store.read.membership(identity!.userId)).toMatchObject({
        status: "active",
        role: "administrator",
        source: purpose,
      })
      expect(await store.read.session(digestSecret(completed.sessionToken!))).toMatchObject({
        userId: identity!.userId,
      })
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
      admissionPolicy: { name: "hub-managed", admit: () => Promise.resolve(true) },
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
