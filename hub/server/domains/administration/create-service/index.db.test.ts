import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createAdministrationService } from "#server/domains/administration/create-service"
import { createIdentityStore } from "#server/domains/identity/create-store"
import { digestSecret } from "#server/utils/digest-secret"

type IdentityStore = ReturnType<typeof createIdentityStore>

async function database() {
  vi.stubGlobal("prisma", undefined)
  const { prisma } = await import("../../../integrations/prisma")
  onTestFinished(() => prisma.$disconnect())
  return { prisma, store: createIdentityStore(prisma) }
}

async function createAdministrator(
  store: IdentityStore,
  subject: string,
  token: string,
  options: {
    role?: "member" | "administrator"
    freshAuthorizedAt?: Date | null
  } = {},
) {
  const authorizedAt = new Date("2026-10-27T18:00:00.000Z")
  const role = options.role ?? "administrator"
  return store.lock(async (records) => {
    const user = await records.createUser({
      displayName: `${role === "administrator" ? "Administrator" : "Member"} ${subject}`,
      avatarUrl: null,
    })
    const identity = await records.saveExternalIdentity({
      userId: user.id,
      provider: "github",
      issuer: "https://github.com",
      subject,
      username: `${role}-${subject}`,
      displayName: user.displayName,
      avatarUrl: null,
    })
    const provider =
      (await records.currentAuthenticationProviderRevision("github")) ??
      (await records.createAuthenticationProviderRevision({
        key: "github",
        type: "github",
        enabled: true,
        revision: 1,
        issuer: "https://github.com",
        configuration: { clientId: "github-client" },
      }))
    const membership = await records.saveMembership({
      userId: user.id,
      status: "active",
      role,
      source: "manual",
      suspendedAt: null,
      removedAt: null,
    })
    const session = await records.createSession({
      userId: user.id,
      externalIdentityId: identity.id,
      authenticationProviderRevisionId: provider.id,
      tokenDigest: digestSecret(token),
      signedInAt: authorizedAt,
      freshAuthorizedAt:
        options.freshAuthorizedAt === undefined ? authorizedAt : options.freshAuthorizedAt,
    })
    return { membership, session, user }
  })
}

describe("createAdministrationService() database behavior", () => {
  it("audits a member's denied invitation without creating it", async () => {
    const { store } = await database()
    await createAdministrator(store, "40", "member-token", { role: "member" })
    const service = createAdministrationService({
      store,
      now: () => new Date("2026-10-27T18:01:00.000Z"),
    })

    await expect(
      service.invite("member-token", {
        provider: "github",
        issuer: "https://github.com",
        subject: "99",
        role: "member",
      }),
    ).rejects.toMatchObject({ code: "administrator_required" })

    expect(await store.read.invitations()).toEqual({
      invitations: [],
      nextCursor: null,
    })
    const [audit] = await store.read.audits()
    expect(audit).toMatchObject({ outcome: "denied" })
    expect(audit?.context).toEqual({ reason: "administrator_required" })
  })

  it("audits stale authorization without applying the requested membership change", async () => {
    const { store } = await database()
    const administrator = await createAdministrator(store, "41", "stale-token")
    const service = createAdministrationService({
      store,
      now: () => new Date("2026-10-27T18:05:00.000Z"),
    })

    await expect(
      service.changeMembership("stale-token", administrator.membership.id, {
        role: "member",
      }),
    ).rejects.toMatchObject({ code: "fresh_authorization_required" })

    expect(await store.read.membership(administrator.user.id)).toMatchObject({
      status: "active",
      role: "administrator",
    })
    const [audit] = await store.read.audits()
    expect(audit).toMatchObject({ outcome: "denied" })
    expect(audit?.context).toEqual({ reason: "fresh_authorization_required" })
  })

  it("audits the final-administrator denial without changing membership or sessions", async () => {
    const { store } = await database()
    const administrator = await createAdministrator(store, "42", "final-token")
    const service = createAdministrationService({
      store,
      now: () => new Date("2026-10-27T18:01:00.000Z"),
    })

    await expect(
      service.changeMembership("final-token", administrator.membership.id, {
        status: "suspended",
      }),
    ).rejects.toMatchObject({ code: "last_administrator" })

    expect(await store.read.membership(administrator.user.id)).toMatchObject({
      status: "active",
      role: "administrator",
      suspendedAt: null,
    })
    expect(await store.read.session(digestSecret("final-token"))).toMatchObject({
      id: administrator.session.id,
    })
    const [audit] = await store.read.audits()
    expect(audit).toMatchObject({ outcome: "denied" })
    expect(audit?.context).toEqual({ reason: "last_administrator" })
  })

  it("audits malformed and missing administration targets without partial mutations", async () => {
    const { store } = await database()
    await createAdministrator(store, "43", "administrator-token")
    const service = createAdministrationService({
      store,
      now: () => new Date("2026-10-27T18:01:00.000Z"),
    })

    await expect(
      service.revokeInvitation("administrator-token", "not-a-uuid"),
    ).rejects.toMatchObject({ code: "invitation_changed" })
    await expect(
      service.changeMembership("administrator-token", "00000000-0000-4000-8000-000000000099", {
        role: "member",
      }),
    ).rejects.toMatchObject({ code: "membership_not_found" })

    expect(await store.read.invitations()).toEqual({
      invitations: [],
      nextCursor: null,
    })
    expect(await store.read.activeAdministratorCount()).toBe(1)
    const audits = await store.read.audits()
    expect(audits.every(({ outcome }) => outcome === "denied")).toBe(true)
    expect(audits.map(({ context }) => context)).toEqual(
      expect.arrayContaining([
        { reason: "invitation_changed" },
        { reason: "membership_not_found" },
      ]),
    )
    expect(audits).toHaveLength(2)
  })

  it("preserves the suspension timestamp when only the suspended member's role changes", async () => {
    const { store } = await database()
    await createAdministrator(store, "41", "administrator-token")
    const suspendedAt = new Date("2026-10-20T12:00:00.000Z")
    const target = await store.lock(async (records) => {
      const user = await records.createUser({
        displayName: "Suspended member",
        avatarUrl: null,
      })
      return records.saveMembership({
        userId: user.id,
        status: "suspended",
        role: "member",
        source: "manual",
        suspendedAt,
        removedAt: null,
      })
    })
    const service = createAdministrationService({
      store,
      now: () => new Date("2026-10-27T18:01:00.000Z"),
    })

    await service.changeMembership("administrator-token", target.id, {
      role: "administrator",
    })

    expect(await store.read.membership(target.userId)).toMatchObject({
      status: "suspended",
      role: "administrator",
      suspendedAt,
      removedAt: null,
    })
  })

  it("audits both changes when restoring a suspended member as an administrator", async () => {
    const { store } = await database()
    await createAdministrator(store, "44", "administrator-token")
    const target = await store.lock(async (records) => {
      const user = await records.createUser({
        displayName: "Suspended member",
        avatarUrl: null,
      })
      return records.saveMembership({
        userId: user.id,
        status: "suspended",
        role: "member",
        source: "manual",
        suspendedAt: new Date("2026-10-20T12:00:00.000Z"),
        removedAt: null,
      })
    })
    const service = createAdministrationService({
      store,
      now: () => new Date("2026-10-27T18:01:00.000Z"),
    })

    await service.changeMembership("administrator-token", target.id, {
      role: "administrator",
      status: "active",
    })

    expect(await store.read.membership(target.userId)).toMatchObject({
      status: "active",
      role: "administrator",
      suspendedAt: null,
      removedAt: null,
    })
    const audits = (await store.read.audits()).filter(
      ({ event, targetMembershipId }) =>
        event === "membership.change" && targetMembershipId === target.id,
    )
    expect(audits.map(({ context }) => context)).toEqual(
      expect.arrayContaining([{ reason: "status_active" }, { reason: "role_administrator" }]),
    )
    expect(audits).toHaveLength(2)
  })

  it("serializes overlapping suspensions so one active administrator and its session remain", async () => {
    const { store } = await database()
    const first = await createAdministrator(store, "41", "first-token")
    const second = await createAdministrator(store, "42", "second-token")
    const service = createAdministrationService({
      store,
      now: () => new Date("2026-10-27T18:01:00.000Z"),
    })

    const results = await Promise.allSettled([
      service.changeMembership("first-token", second.membership.id, {
        status: "suspended",
      }),
      service.changeMembership("second-token", first.membership.id, {
        status: "suspended",
      }),
    ])

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1)
    expect(await store.read.activeAdministratorCount()).toBe(1)

    const { memberships } = await store.read.memberships()
    const active = memberships.find(({ status }) => status === "active")
    const suspended = memberships.find(({ status }) => status === "suspended")
    expect(active).toBeDefined()
    expect(suspended).toBeDefined()
    const activeToken = active?.id === first.membership.id ? "first-token" : "second-token"
    const suspendedToken = suspended?.id === first.membership.id ? "first-token" : "second-token"
    expect(await store.read.session(digestSecret(activeToken))).toBeTruthy()
    expect(await store.read.session(digestSecret(suspendedToken))).toBeNull()
    const audits = await store.read.audits()
    expect(
      audits.find(
        ({ event, outcome, targetMembershipId }) =>
          event === "membership.change" &&
          outcome === "succeeded" &&
          targetMembershipId === suspended?.id,
      ),
    ).toMatchObject({ context: { reason: "status_suspended" } })
    expect(audits.every(({ outcome }) => outcome === "succeeded" || outcome === "denied")).toBe(
      true,
    )
  })
})
