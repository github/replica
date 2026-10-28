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
    source?: "manual" | "synchronized"
  } = {},
) {
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
      role: options.role ?? "administrator",
      source: options.source ?? "manual",
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

  it("allows installation role demotion but prevents workspace orphaning on suspension", async () => {
    const { prisma, store } = await database()
    const actor = await createAdministrator(store, "workspace-actor", "workspace-actor-token")
    const target = await createAdministrator(store, "workspace-target", "workspace-target-token")
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: target.user.id,
        grants: {
          create: {
            userId: target.user.id,
            effect: "allow",
            role: "administrator",
          },
        },
      },
    })
    const service = createAdministrationService({
      store,
      now: () => new Date("2026-10-27T18:01:00.000Z"),
    })

    await expect(
      service.changeMembership("workspace-actor-token", target.membership.id, {
        role: "member",
      }),
    ).resolves.toMatchObject({
      userId: target.user.id,
      role: "member",
      status: "active",
    })
    expect(
      await prisma.workspaceAccessGrant.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: target.user.id,
          },
        },
      }),
    ).toMatchObject({ effect: "allow", role: "administrator" })

    await expect(
      service.changeMembership("workspace-actor-token", target.membership.id, {
        status: "suspended",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "product_administration_orphaned",
      message: "Transfer workspace administration before changing this membership.",
    })

    await prisma.workspaceAccessGrant.create({
      data: {
        workspaceId: workspace.id,
        userId: actor.user.id,
        effect: "allow",
        role: "administrator",
      },
    })
    await expect(
      service.changeMembership("workspace-actor-token", target.membership.id, {
        status: "suspended",
      }),
    ).resolves.toMatchObject({
      userId: target.user.id,
      role: "member",
      status: "suspended",
    })
    expect(await store.read.session(digestSecret("workspace-target-token"))).toBeNull()
    const targetAudits = (await store.read.audits()).filter(({ targetMembershipId }) => {
      return targetMembershipId === target.membership.id
    })
    expect(targetAudits.every(({ event }) => event === "membership.change")).toBe(true)
    expect(
      targetAudits.map(({ context }) => (context as { reason: string }).reason).sort(),
    ).toEqual(["role_member", "status_suspended"])
  })

  it("prevents prototype orphaning on removal until an active replacement is assigned", async () => {
    const { prisma, store } = await database()
    const actor = await createAdministrator(store, "prototype-actor", "prototype-actor-token")
    const target = await createAdministrator(store, "prototype-target", "prototype-target-token")
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: target.user.id,
        grants: {
          create: [
            {
              userId: actor.user.id,
              effect: "allow",
              role: "administrator",
            },
            {
              userId: target.user.id,
              effect: "allow",
              role: "viewer",
            },
          ],
        },
      },
    })
    const prototype = await prisma.prototype.create({
      data: {
        name: "Prototype",
        workspaceId: workspace.id,
        createdByUserId: target.user.id,
        grants: {
          create: [
            {
              userId: actor.user.id,
              effect: "allow",
              role: "viewer",
            },
            {
              userId: target.user.id,
              effect: "allow",
              role: "administrator",
            },
          ],
        },
      },
    })
    const service = createAdministrationService({
      store,
      now: () => new Date("2026-10-27T18:01:00.000Z"),
    })

    await expect(
      service.changeMembership("prototype-actor-token", target.membership.id, {
        status: "removed",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "product_administration_orphaned",
      message: "Transfer prototype administration before changing this membership.",
    })

    await prisma.prototypeAccessGrant.update({
      where: {
        prototypeId_userId: {
          prototypeId: prototype.id,
          userId: actor.user.id,
        },
      },
      data: { role: "administrator" },
    })
    await expect(
      service.changeMembership("prototype-actor-token", target.membership.id, {
        status: "removed",
      }),
    ).resolves.toMatchObject({
      userId: target.user.id,
      status: "removed",
    })
    expect(await store.read.session(digestSecret("prototype-target-token"))).toBeNull()
    expect(
      await prisma.securityAudit.findMany({
        where: { targetMembershipId: target.membership.id },
        select: { event: true, context: true },
      }),
    ).toEqual([
      {
        event: "membership.change",
        context: { reason: "status_removed" },
      },
    ])
  })

  it("does not count a workspace administrator denied on the prototype as a replacement", async () => {
    const { prisma, store } = await database()
    const actor = await createAdministrator(store, "denied-actor", "denied-actor-token")
    const target = await createAdministrator(store, "denied-target", "denied-target-token")
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: target.user.id,
        grants: {
          create: {
            userId: actor.user.id,
            effect: "allow",
            role: "administrator",
          },
        },
      },
    })
    const prototype = await prisma.prototype.create({
      data: {
        name: "Prototype",
        workspaceId: workspace.id,
        createdByUserId: target.user.id,
        grants: {
          create: [
            {
              userId: actor.user.id,
              effect: "deny",
            },
            {
              userId: target.user.id,
              effect: "allow",
              role: "administrator",
            },
          ],
        },
      },
    })
    const service = createAdministrationService({
      store,
      now: () => new Date("2026-10-27T18:01:00.000Z"),
    })

    await expect(
      service.changeMembership("denied-actor-token", target.membership.id, {
        status: "suspended",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "product_administration_orphaned",
      message: "Transfer prototype administration before changing this membership.",
    })

    await prisma.prototypeAccessGrant.delete({
      where: {
        prototypeId_userId: {
          prototypeId: prototype.id,
          userId: actor.user.id,
        },
      },
    })
    await expect(
      service.changeMembership("denied-actor-token", target.membership.id, {
        status: "suspended",
      }),
    ).resolves.toMatchObject({
      userId: target.user.id,
      status: "suspended",
    })
  })

  it("requires active replacements for every prototype a removed member administers", async () => {
    const { prisma, store } = await database()
    const actor = await createAdministrator(store, "multi-scope-actor", "multi-scope-actor-token")
    const target = await createAdministrator(
      store,
      "multi-scope-target",
      "multi-scope-target-token",
    )
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: target.user.id,
        grants: {
          create: [
            {
              userId: actor.user.id,
              effect: "allow",
              role: "viewer",
            },
            {
              userId: target.user.id,
              effect: "allow",
              role: "viewer",
            },
          ],
        },
      },
    })
    const prototypes = await Promise.all(
      ["First prototype", "Second prototype"].map((name, index) =>
        prisma.prototype.create({
          data: {
            name,
            workspaceId: workspace.id,
            createdByUserId: target.user.id,
            grants: {
              create: [
                {
                  userId: actor.user.id,
                  effect: "allow",
                  role: index === 0 ? "administrator" : "viewer",
                },
                {
                  userId: target.user.id,
                  effect: "allow",
                  role: "administrator",
                },
              ],
            },
          },
        }),
      ),
    )
    const service = createAdministrationService({
      store,
      now: () => new Date("2026-10-27T18:01:00.000Z"),
    })

    await expect(
      service.changeMembership("multi-scope-actor-token", target.membership.id, {
        status: "removed",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "product_administration_orphaned",
    })
    expect(await store.read.session(digestSecret("multi-scope-target-token"))).toBeTruthy()

    await prisma.prototypeAccessGrant.update({
      where: {
        prototypeId_userId: {
          prototypeId: prototypes[1]!.id,
          userId: actor.user.id,
        },
      },
      data: { role: "administrator" },
    })
    await expect(
      service.changeMembership("multi-scope-actor-token", target.membership.id, {
        status: "removed",
      }),
    ).resolves.toMatchObject({
      userId: target.user.id,
      status: "removed",
    })
    expect(await store.read.session(digestSecret("multi-scope-target-token"))).toBeNull()
  })

  it("makes a synchronized membership manual when an administrator grants installation administration", async () => {
    const { store } = await database()
    await createAdministrator(store, "actor", "actor-token")
    const target = await createAdministrator(store, "target", "target-token", {
      role: "member",
      source: "synchronized",
    })
    const service = createAdministrationService({
      store,
      now: () => new Date("2026-10-27T18:01:00.000Z"),
    })

    await expect(
      service.changeMembership("actor-token", target.membership.id, {
        role: "administrator",
      }),
    ).resolves.toMatchObject({
      role: "administrator",
      source: "manual",
      status: "active",
    })
  })

  it.each(["suspended", "removed"] as const)(
    "makes an administrator's %s decision manual for a synchronized membership",
    async (status) => {
      const { store } = await database()
      await createAdministrator(store, "actor", "actor-token")
      const target = await createAdministrator(store, "target", "target-token", {
        role: "member",
        source: "synchronized",
      })
      const service = createAdministrationService({
        store,
        now: () => new Date("2026-10-27T18:01:00.000Z"),
      })

      await expect(
        service.changeMembership("actor-token", target.membership.id, { status }),
      ).resolves.toMatchObject({
        source: "manual",
        status,
      })
      expect(await store.read.session(digestSecret("target-token"))).toBeNull()
    },
  )
})
