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

async function createAdministrator(store: IdentityStore, subject: string, token: string) {
  const authorizedAt = new Date("2026-10-27T18:00:00.000Z")
  return store.lock(async (records) => {
    const user = await records.createUser({
      displayName: `Administrator ${subject}`,
      avatarUrl: null,
    })
    const identity = await records.saveExternalIdentity({
      userId: user.id,
      provider: "github",
      issuer: "https://github.com",
      subject,
      username: `administrator-${subject}`,
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
      role: "administrator",
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
      freshAuthorizedAt: authorizedAt,
    })
    return { membership, session, user }
  })
}

describe("createAdministrationService() database behavior", () => {
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

    const memberships = await store.read.memberships()
    const active = memberships.find(({ status }) => status === "active")
    const suspended = memberships.find(({ status }) => status === "suspended")
    expect(active).toBeDefined()
    expect(suspended).toBeDefined()
    const activeToken = active?.id === first.membership.id ? "first-token" : "second-token"
    const suspendedToken = suspended?.id === first.membership.id ? "first-token" : "second-token"
    expect(await store.read.session(digestSecret(activeToken))).toBeTruthy()
    expect(await store.read.session(digestSecret(suspendedToken))).toBeNull()
    expect(await store.read.audits()).toEqual([
      expect.objectContaining({
        event: "membership.change",
        outcome: "succeeded",
        targetMembershipId: suspended?.id,
        context: { reason: "status_suspended" },
      }),
    ])
  })
})
