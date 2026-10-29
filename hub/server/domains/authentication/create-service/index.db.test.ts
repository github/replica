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
