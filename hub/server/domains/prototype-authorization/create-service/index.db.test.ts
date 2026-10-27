import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createIdentityStore } from "#server/domains/identity/create-store"
import { createPrototypeAuthorizationService } from "#server/domains/prototype-authorization/create-service"
import { digestSecret } from "#server/utils/digest-secret"

type IdentityStore = ReturnType<typeof createIdentityStore>

async function database() {
  vi.stubGlobal("prisma", undefined)
  const { prisma } = await import("../../../integrations/prisma")
  onTestFinished(() => prisma.$disconnect())
  return {
    prisma,
    store: createIdentityStore(prisma),
    service: createPrototypeAuthorizationService({
      database: prisma,
      store: createIdentityStore(prisma),
    }),
  }
}

async function createActor(
  store: IdentityStore,
  {
    subject,
    token,
    role = "member",
  }: {
    subject: string
    token: string
    role?: "member" | "administrator"
  },
) {
  const authorizedAt = new Date()
  return store.lock(async (records) => {
    const user = await records.createUser({
      displayName: `User ${subject}`,
      avatarUrl: null,
    })
    const identity = await records.saveExternalIdentity({
      userId: user.id,
      provider: "github",
      issuer: "https://github.com",
      subject,
      username: `user-${subject}`,
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

describe("createPrototypeAuthorizationService() database behavior", () => {
  it("separates installation authority from prototype access and explicitly grants a creator", async () => {
    const { prisma, service, store } = await database()
    const administrator = await createActor(store, {
      subject: "administrator",
      token: "administrator-token",
      role: "administrator",
    })
    const member = await createActor(store, {
      subject: "member",
      token: "member-token",
    })
    const existingWorkspace = await prisma.workspace.create({
      data: {
        name: "Existing workspace",
        createdByUserId: member.user.id,
      },
    })

    await expect(
      service.getWorkspace("administrator-token", existingWorkspace.id),
    ).rejects.toMatchObject({
      status: 403,
      code: "prototype_access_denied",
    })
    await prisma.workspaceAccessGrant.create({
      data: {
        workspaceId: existingWorkspace.id,
        userId: member.user.id,
        effect: "allow",
        role: "viewer",
      },
    })
    await expect(service.getWorkspace("member-token", existingWorkspace.id)).resolves.toMatchObject(
      {
        id: existingWorkspace.id,
      },
    )

    const created = (await service.createWorkspace("administrator-token", {
      name: "Created workspace",
    })) as { id: string }

    await expect(service.getWorkspace("administrator-token", created.id)).resolves.toMatchObject({
      id: created.id,
      createdByUserId: administrator.user.id,
    })
    await expect(service.getWorkspace("member-token", created.id)).rejects.toMatchObject({
      status: 403,
      code: "prototype_access_denied",
    })
    expect(
      await prisma.workspaceAccessGrant.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: created.id,
            userId: administrator.user.id,
          },
        },
      }),
    ).toMatchObject({
      effect: "allow",
      role: "administrator",
    })
  })

  it("isolates grants and immutable versions by prototype", async () => {
    const { prisma, service, store } = await database()
    const actor = await createActor(store, { subject: "isolated", token: "isolated-token" })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: actor.user.id,
      },
    })
    const [allowedPrototype, otherPrototype] = await Promise.all([
      prisma.prototype.create({
        data: {
          name: "Allowed",
          workspaceId: workspace.id,
          createdByUserId: actor.user.id,
          grants: {
            create: {
              userId: actor.user.id,
              effect: "allow",
              role: "viewer",
            },
          },
        },
      }),
      prisma.prototype.create({
        data: {
          name: "Other",
          workspaceId: workspace.id,
          createdByUserId: actor.user.id,
        },
      }),
    ])
    const otherVersion = await prisma.prototypeVersion.create({
      data: {
        prototypeId: otherPrototype.id,
        createdByUserId: actor.user.id,
        sequence: 1,
        label: "Other version",
      },
    })

    await expect(
      service.getPrototype("isolated-token", allowedPrototype.id),
    ).resolves.toMatchObject({
      id: allowedPrototype.id,
    })
    await expect(service.getPrototype("isolated-token", otherPrototype.id)).rejects.toMatchObject({
      status: 403,
      code: "prototype_access_denied",
    })
    await expect(
      service.getVersion("isolated-token", allowedPrototype.id, otherVersion.id),
    ).rejects.toMatchObject({
      status: 404,
      code: "version_not_found",
    })
  })

  it("rechecks membership in the mutation transaction instead of trusting a stale session", async () => {
    const { prisma, service, store } = await database()
    const actor = await createActor(store, {
      subject: "stale",
      token: "stale-token",
      role: "administrator",
    })
    const target = await createActor(store, { subject: "stale-target", token: "target-token" })
    const workspace = (await service.createWorkspace("stale-token", {
      name: "Workspace",
    })) as { id: string }

    await store.lock((records) =>
      records.saveMembership({
        userId: actor.user.id,
        status: "suspended",
        role: "administrator",
        source: "manual",
        suspendedAt: new Date("2026-10-27T18:01:00.000Z"),
      }),
    )

    await expect(
      service.setWorkspaceAccess("stale-token", workspace.id, target.user.id, {
        effect: "allow",
        role: "viewer",
      }),
    ).rejects.toMatchObject({
      status: 401,
      code: "membership_inactive",
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
    ).toBeNull()
    expect(
      await prisma.securityAudit.count({
        where: { targetUserId: target.user.id },
      }),
    ).toBe(0)
  })

  it("commits one valid rule and an audit for each successful concurrent access change", async () => {
    const { prisma, service, store } = await database()
    const administrator = await createActor(store, {
      subject: "concurrent-administrator",
      token: "concurrent-administrator-token",
      role: "administrator",
    })
    const target = await createActor(store, {
      subject: "concurrent-target",
      token: "concurrent-target-token",
    })
    const workspace = (await service.createWorkspace("concurrent-administrator-token", {
      name: "Workspace",
    })) as { id: string }
    const prototype = (await service.createPrototype(
      "concurrent-administrator-token",
      workspace.id,
      { name: "Prototype" },
    )) as { id: string }

    const results = await Promise.allSettled([
      service.setPrototypeAccess("concurrent-administrator-token", prototype.id, target.user.id, {
        effect: "allow",
        role: "editor",
      }),
      service.setPrototypeAccess("concurrent-administrator-token", prototype.id, target.user.id, {
        effect: "deny",
      }),
    ])

    const fulfilled = results.filter(({ status }) => status === "fulfilled")
    const grant = await prisma.prototypeAccessGrant.findUnique({
      where: {
        prototypeId_userId: {
          prototypeId: prototype.id,
          userId: target.user.id,
        },
      },
    })
    const audits = await prisma.securityAudit.findMany({
      where: {
        prototypeId: prototype.id,
        targetUserId: target.user.id,
      },
      orderBy: { createdAt: "asc" },
    })

    expect(fulfilled.length).toBeGreaterThan(0)
    expect(grant).toMatchObject(
      grant?.effect === "deny"
        ? { effect: "deny", role: null }
        : { effect: "allow", role: "editor" },
    )
    expect(audits).toHaveLength(fulfilled.length)
    expect(audits.map(({ event }) => event).sort()).toEqual(
      fulfilled.length === 2
        ? ["prototype.access.deny", "prototype.access.grant"]
        : [grant?.effect === "deny" ? "prototype.access.deny" : "prototype.access.grant"],
    )
    expect(audits.every(({ actorUserId }) => actorUserId === administrator.user.id)).toBe(true)
  })

  it("rolls back an access change when its audit cannot be saved", async () => {
    const { prisma, service, store } = await database()
    await createActor(store, {
      subject: "rollback-administrator",
      token: "rollback-administrator-token",
      role: "administrator",
    })
    const target = await createActor(store, {
      subject: "rollback-target",
      token: "rollback-target-token",
    })
    const workspace = (await service.createWorkspace("rollback-administrator-token", {
      name: "Workspace",
    })) as { id: string }
    const prototype = (await service.createPrototype("rollback-administrator-token", workspace.id, {
      name: "Prototype",
    })) as { id: string }

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION reject_prototype_access_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.event = 'prototype.access.grant' THEN
          RAISE EXCEPTION 'audit unavailable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER reject_prototype_access_audit
      BEFORE INSERT ON security_audits
      FOR EACH ROW EXECUTE FUNCTION reject_prototype_access_audit();
    `)
    try {
      await expect(
        service.setPrototypeAccess("rollback-administrator-token", prototype.id, target.user.id, {
          effect: "allow",
          role: "viewer",
        }),
      ).rejects.toThrow("audit unavailable")
    } finally {
      await prisma.$executeRawUnsafe(
        "DROP TRIGGER reject_prototype_access_audit ON security_audits",
      )
      await prisma.$executeRawUnsafe("DROP FUNCTION reject_prototype_access_audit()")
    }

    expect(
      await prisma.prototypeAccessGrant.findUnique({
        where: {
          prototypeId_userId: {
            prototypeId: prototype.id,
            userId: target.user.id,
          },
        },
      }),
    ).toBeNull()
    expect(
      await prisma.securityAudit.count({
        where: {
          event: "prototype.access.grant",
          prototypeId: prototype.id,
          targetUserId: target.user.id,
        },
      }),
    ).toBe(0)
  })

  it("bounds pages at 100, follows the cursor, and rejects larger limits", async () => {
    const { prisma, service, store } = await database()
    const actor = await createActor(store, { subject: "pagination", token: "pagination-token" })
    const workspaces = await Promise.all(
      Array.from({ length: 101 }, (_, index) =>
        prisma.workspace.create({
          data: {
            name: `Workspace ${index.toString().padStart(3, "0")}`,
            createdByUserId: actor.user.id,
            grants: {
              create: {
                userId: actor.user.id,
                effect: "allow",
                role: "viewer",
              },
            },
          },
        }),
      ),
    )

    const first = (await service.listWorkspaces("pagination-token", {
      limit: 100,
    })) as { items: { id: string }[]; nextCursor: string | null }
    const second = (await service.listWorkspaces("pagination-token", {
      limit: 100,
      cursor: first.nextCursor,
    })) as { items: { id: string }[]; nextCursor: string | null }

    expect(first.items).toHaveLength(100)
    expect(first.nextCursor).toBe(first.items.at(-1)?.id)
    expect(second.items).toHaveLength(1)
    expect(second.nextCursor).toBeNull()
    expect(new Set([...first.items, ...second.items].map(({ id }) => id))).toEqual(
      new Set(workspaces.map(({ id }) => id)),
    )
    await expect(service.listWorkspaces("pagination-token", { limit: 101 })).rejects.toMatchObject({
      status: 422,
      code: "invalid_pagination",
    })
  })

  it("creates sequential immutable versions and rejects additions after archival", async () => {
    const { prisma, service, store } = await database()
    await createActor(store, {
      subject: "versions",
      token: "versions-token",
      role: "administrator",
    })
    const workspace = (await service.createWorkspace("versions-token", {
      name: "Workspace",
    })) as { id: string }
    const prototype = (await service.createPrototype("versions-token", workspace.id, {
      name: "Prototype",
    })) as { id: string }

    const created = await Promise.all([
      service.createVersion("versions-token", prototype.id, { label: "First request" }),
      service.createVersion("versions-token", prototype.id, { label: "Second request" }),
    ])

    expect(
      created
        .map((version) => (version as { sequence: number }).sequence)
        .sort((left, right) => left - right),
    ).toEqual([1, 2])
    expect(
      await prisma.prototypeVersion.findMany({
        where: { prototypeId: prototype.id },
        orderBy: { sequence: "asc" },
        select: { sequence: true },
      }),
    ).toEqual([{ sequence: 1 }, { sequence: 2 }])

    await service.archivePrototype("versions-token", prototype.id)
    await expect(
      service.createVersion("versions-token", prototype.id, { label: "Too late" }),
    ).rejects.toMatchObject({
      status: 409,
      code: "prototype_archived",
    })
    expect(await prisma.prototypeVersion.count({ where: { prototypeId: prototype.id } })).toBe(2)
    const audits = await prisma.securityAudit.findMany({
      where: { prototypeId: prototype.id },
      orderBy: { createdAt: "asc" },
      select: {
        event: true,
        context: true,
        prototypeVersionId: true,
      },
    })
    expect(audits.map(({ event }) => event)).toEqual([
      "prototype.create",
      "prototype.version.create",
      "prototype.version.create",
      "prototype.archive",
    ])
    expect(audits.every(({ context }) => JSON.stringify(context) === "{}")).toBe(true)
    expect(audits[0]?.prototypeVersionId).toBeNull()
    expect(audits[1]?.prototypeVersionId).toEqual(expect.any(String))
    expect(audits[2]?.prototypeVersionId).toEqual(expect.any(String))
    expect(audits[3]?.prototypeVersionId).toBeNull()
  })
})
