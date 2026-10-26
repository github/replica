import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createIdentityStore } from "#server/domains/identity/create-store"

async function database() {
  vi.stubGlobal("prisma", undefined)
  const { prisma } = await import("../../../integrations/prisma")
  onTestFinished(() => prisma.$disconnect())
  return { prisma, store: createIdentityStore(prisma) }
}

describe("createIdentityStore()", () => {
  it("rolls back credential, session, generation, and audit changes together", async () => {
    const { store } = await database()
    await store.lock(async (records) => {
      const user = await records.saveUser({
        providerId: "10001",
        login: "synthetic-user",
        name: null,
        avatarUrl: null,
      })
      await records.saveCredentials("initial-encrypted-fixture")
      await records.createSession({
        userId: user.id,
        tokenDigest: "synthetic-token-digest",
        signedInAt: new Date(),
        freshAuthorizedAt: new Date(),
        credentialRevision: "initial-revision",
      })
    })

    await expect(
      store.lock(async (records) => {
        await records.saveCredentials("replacement-encrypted-fixture")
        await records.advanceGeneration()
        await records.deleteSessions()
        await records.audit({ event: "session.revoke_all", actorId: null, sessionId: null })
        throw new Error("Transaction failed")
      }),
    ).rejects.toThrow("Transaction failed")

    expect(await store.read.state()).toMatchObject({
      generation: 0,
      encryptedCredentials: "initial-encrypted-fixture",
    })
    expect(await store.read.session("synthetic-token-digest")).not.toBeNull()
    expect(await store.read.audits()).toEqual([])
  })

  it("serializes locks so an overlapping mutation reads the committed generation", async () => {
    const { store } = await database()
    await store.lock(() => Promise.resolve())
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = store.lock(async (records) => {
      await records.advanceGeneration()
      entered()
      await gate
    })
    await started
    const second = store.lock(async (records) => {
      const state = await records.state()
      await records.advanceGeneration()
      return state.generation
    })
    release()

    await first
    expect(await second).toBe(1)
    expect((await store.read.state()).generation).toBe(2)
  })

  it("upserts by immutable GitHub account rather than a reused login", async () => {
    const { store } = await database()
    const profile = { providerId: "10001", login: "synthetic-user", name: null, avatarUrl: null }
    const original = await store.lock((records) => records.saveUser(profile))
    await store.lock((records) => records.enroll(original.id))
    const renamed = await store.lock((records) =>
      records.saveUser({ ...profile, login: "renamed-user" }),
    )
    const reused = await store.lock((records) =>
      records.saveUser({ ...profile, providerId: "20002" }),
    )

    expect(renamed.id).toBe(original.id)
    expect(renamed.administrator).toBe(true)
    expect(reused.id).not.toBe(original.id)
    expect(reused.administrator).toBe(false)
  })

  it("consumes an OAuth attempt once across concurrent transactions and clears pending attempts on a cutoff", async () => {
    const { store } = await database()
    const input = {
      stateDigest: "synthetic-state-digest",
      browserDigest: "synthetic-browser-digest",
      verifier: "synthetic-verifier",
      generation: 0,
      credentialRevision: "synthetic-revision",
      purpose: "sign-in" as const,
      sessionId: null,
      expiresAt: new Date(Date.now() + 15 * 60_000),
    }
    await store.lock((records) => records.createAttempt(input))
    const results = await Promise.all([
      store.lock((records) => records.consumeAttempt(input.stateDigest)),
      store.lock((records) => records.consumeAttempt(input.stateDigest)),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(results.find(Boolean)).toMatchObject(input)

    await store.lock((records) => records.createAttempt({ ...input, stateDigest: "pending-state" }))
    await store.lock((records) => records.advanceGeneration())
    expect(await store.lock((records) => records.consumeAttempt("pending-state"))).toBeNull()
  })

  it("invalidates fresh proof without deleting sessions and removes originating attempts on sign-out", async () => {
    const { store } = await database()
    const session = await store.lock(async (records) => {
      const user = await records.saveUser({
        providerId: "10001",
        login: "synthetic-user",
        name: null,
        avatarUrl: null,
      })
      const session = await records.createSession({
        userId: user.id,
        tokenDigest: "synthetic-token-digest",
        signedInAt: new Date(),
        freshAuthorizedAt: new Date(),
        credentialRevision: "synthetic-revision",
      })
      await records.createAttempt({
        stateDigest: "synthetic-state-digest",
        browserDigest: "synthetic-browser-digest",
        verifier: "synthetic-verifier",
        generation: 0,
        credentialRevision: "synthetic-revision",
        purpose: "verify",
        sessionId: session.id,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      })
      return session
    })

    await store.lock((records) => records.invalidateFreshness())
    expect(await store.read.sessionById(session.id)).toMatchObject({ freshAuthorizedAt: null })
    await store.lock((records) => records.deleteSession(session.id))
    expect(await store.read.session("synthetic-token-digest")).toBeNull()
    expect(
      await store.lock((records) => records.consumeAttempt("synthetic-state-digest")),
    ).toBeNull()
  })

  it("hides audits older than ninety days and prunes them on writes while retaining the cutoff", async () => {
    const { prisma, store } = await database()
    const now = Date.now()
    vi.spyOn(Date, "now").mockReturnValue(now)
    const cutoff = now - 90 * 24 * 60 * 60_000
    const old = await prisma.securityAudit.create({
      data: {
        event: "identity.denied.request_failed",
        createdAt: new Date(cutoff - 1),
      },
    })
    const retained = await prisma.securityAudit.create({
      data: {
        event: "session.sign_in",
        createdAt: new Date(cutoff),
      },
    })

    expect((await store.read.audits()).map(({ id }) => id)).toEqual([retained.id])
    expect(await prisma.securityAudit.findUnique({ where: { id: old.id } })).not.toBeNull()
    await store.lock((records) =>
      records.audit({ event: "credentials.setup", actorId: null, sessionId: null }),
    )

    expect(await prisma.securityAudit.findUnique({ where: { id: old.id } })).toBeNull()
    expect(await prisma.securityAudit.findUnique({ where: { id: retained.id } })).not.toBeNull()
    expect((await store.read.audits()).map(({ event }) => event)).toEqual([
      "credentials.setup",
      "session.sign_in",
    ])
    expect(await prisma.securityAudit.count()).toBe(2)
  })
})
