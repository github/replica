import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createIdentityStore } from "#server/domains/identity/create-store"
import { createPrototypeAuthorizationService } from "#server/domains/prototype-authorization/create-service"
import type { PrototypeBaselinePolicy } from "#server/domains/prototype-authorization/create-service/types"
import { digestSecret } from "#server/utils/digest-secret"

import type { PrismaClient } from "../../../generated/prisma/client.ts"

type IdentityStore = ReturnType<typeof createIdentityStore>

async function database(baseline?: PrototypeBaselinePolicy) {
  vi.stubGlobal("prisma", undefined)
  const { prisma } = await import("../../../integrations/prisma")
  onTestFinished(() => prisma.$disconnect())
  return {
    prisma,
    store: createIdentityStore(prisma),
    service: createPrototypeAuthorizationService({
      baseline,
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
    source = "manual",
  }: {
    subject: string
    token: string
    role?: "member" | "administrator"
    source?: "manual" | "synchronized"
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
      source,
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

async function waitForBlockedRowLock(database: PrismaClient, table: string) {
  const queryPattern = `%${table}%FOR UPDATE%`
  await vi.waitFor(
    async () => {
      const [result] = await database.$queryRaw<{ blocked: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'
            AND query LIKE ${queryPattern}
        ) AS blocked
      `
      expect(result?.blocked).toBe(true)
    },
    { interval: 20, timeout: 5_000 },
  )
}

function deferred() {
  let resolvePromise!: () => void
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

async function holdWorkspaceLock(database: PrismaClient, workspaceId: string) {
  const released = deferred()
  const locked = deferred()
  const holder = database.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id" FROM "workspaces" WHERE "id" = ${workspaceId}::uuid FOR UPDATE
    `
    locked.resolve()
    await released.promise
  })
  await locked.promise
  return { holder, release: released.resolve }
}

async function holdPrototypeLock(database: PrismaClient, prototypeId: string) {
  const released = deferred()
  const locked = deferred()
  const holder = database.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id" FROM "prototypes" WHERE "id" = ${prototypeId}::uuid FOR UPDATE
    `
    locked.resolve()
    await released.promise
  })
  await locked.promise
  return { holder, release: released.resolve }
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

  it("rejects workspace creation with stale verification without writing product state", async () => {
    const { prisma, service, store } = await database()
    const actor = await createActor(store, {
      subject: "stale-workspace-creator",
      token: "stale-workspace-creator-token",
      role: "administrator",
    })
    await prisma.session.update({
      where: { id: actor.session.id },
      data: { freshAuthorizedAt: new Date(Date.now() - 5 * 60_000) },
    })

    await expect(
      service.createWorkspace("stale-workspace-creator-token", { name: "Rejected workspace" }),
    ).rejects.toMatchObject({
      status: 403,
      code: "fresh_authorization_required",
    })
    expect(await prisma.workspace.count()).toBe(0)
    expect(await prisma.workspaceAccessGrant.count()).toBe(0)
    expect(await prisma.securityAudit.count()).toBe(0)
  })

  it("enforces fresh prototype administration and saves authorization mode changes with audits", async () => {
    const { prisma, service, store } = await database()
    const actor = await createActor(store, {
      subject: "authorization-administrator",
      token: "authorization-administrator-token",
      role: "administrator",
    })
    const workspace = (await service.createWorkspace("authorization-administrator-token", {
      name: "Workspace",
    })) as { id: string }
    const prototype = (await service.createPrototype(
      "authorization-administrator-token",
      workspace.id,
      { name: "Prototype" },
    )) as {
      id: string
      authorizationMode: string
      sourceRepositoryId: string | null
    }
    expect(prototype).toMatchObject({
      authorizationMode: "hub-managed",
      sourceRepositoryId: null,
    })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
        status: "suspended",
      },
    })
    await prisma.session.update({
      where: { id: actor.session.id },
      data: { freshAuthorizedAt: new Date(Date.now() - 5 * 60_000) },
    })

    await expect(
      service.setPrototypeAuthorization("authorization-administrator-token", prototype.id, {
        mode: "github-synchronized",
        repositorySourceId: source.id,
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "fresh_authorization_required",
    })
    await prisma.session.update({
      where: { id: actor.session.id },
      data: { freshAuthorizedAt: new Date() },
    })
    await expect(
      service.setPrototypeAuthorization("authorization-administrator-token", prototype.id, {
        mode: "github-synchronized",
        repositorySourceId: source.id,
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: "repository_source_unavailable",
    })
    expect(await prisma.prototype.findUniqueOrThrow({ where: { id: prototype.id } })).toMatchObject(
      {
        authorizationMode: "hub-managed",
        sourceRepositoryId: null,
      },
    )
    expect(
      await prisma.securityAudit.count({
        where: { event: "prototype.authorization.policy", prototypeId: prototype.id },
      }),
    ).toBe(0)

    await prisma.gitHubRepositorySource.update({
      where: { id: source.id },
      data: { status: "active", removedAt: null },
    })
    await expect(
      service.setPrototypeAuthorization("authorization-administrator-token", prototype.id, {
        mode: "github-synchronized",
        repositorySourceId: source.id,
      }),
    ).resolves.toMatchObject({
      authorizationMode: "github-synchronized",
      sourceRepositoryId: source.id,
    })
    await expect(
      service.getPrototype("authorization-administrator-token", prototype.id),
    ).resolves.toMatchObject({
      authorizationMode: "github-synchronized",
      sourceRepositoryId: source.id,
    })
    await expect(
      service.listPrototypes("authorization-administrator-token", workspace.id, {}),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          id: prototype.id,
          authorizationMode: "github-synchronized",
          sourceRepositoryId: source.id,
        }),
      ],
    })
    expect(await prisma.prototype.findUniqueOrThrow({ where: { id: prototype.id } })).toMatchObject(
      {
        authorizationMode: "github-synchronized",
        sourceRepositoryId: source.id,
      },
    )

    await expect(
      service.setPrototypeAuthorization("authorization-administrator-token", prototype.id, {
        mode: "hub-managed",
      }),
    ).resolves.toMatchObject({
      authorizationMode: "hub-managed",
      sourceRepositoryId: null,
    })
    expect(await prisma.prototype.findUniqueOrThrow({ where: { id: prototype.id } })).toMatchObject(
      {
        authorizationMode: "hub-managed",
        sourceRepositoryId: null,
      },
    )
    expect(
      await prisma.securityAudit.findMany({
        where: { event: "prototype.authorization.policy", prototypeId: prototype.id },
        orderBy: { createdAt: "asc" },
        select: {
          actorUserId: true,
          githubRepositorySourceId: true,
          context: true,
        },
      }),
    ).toEqual([
      {
        actorUserId: actor.user.id,
        githubRepositorySourceId: source.id,
        context: { reason: "github_synchronized" },
      },
      {
        actorUserId: actor.user.id,
        githubRepositorySourceId: null,
        context: { reason: "hub_managed" },
      },
    ])
  })

  it("rejects workspace creation by a member without writing product state", async () => {
    const { prisma, service, store } = await database()
    await createActor(store, {
      subject: "member-workspace-creator",
      token: "member-workspace-creator-token",
    })

    await expect(
      service.createWorkspace("member-workspace-creator-token", { name: "Rejected workspace" }),
    ).rejects.toMatchObject({
      status: 403,
      code: "installation_administrator_required",
    })
    expect(await prisma.workspace.count()).toBe(0)
    expect(await prisma.workspaceAccessGrant.count()).toBe(0)
    expect(await prisma.securityAudit.count()).toBe(0)
  })

  it("rejects prototype creation by a workspace viewer without writing product state", async () => {
    const { prisma, service, store } = await database()
    const actor = await createActor(store, {
      subject: "viewer-prototype-creator",
      token: "viewer-prototype-creator-token",
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: actor.user.id,
        grants: {
          create: {
            userId: actor.user.id,
            effect: "allow",
            role: "viewer",
          },
        },
      },
    })

    await expect(
      service.createPrototype("viewer-prototype-creator-token", workspace.id, {
        name: "Rejected prototype",
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "prototype_access_denied",
    })
    expect(await prisma.prototype.count()).toBe(0)
    expect(await prisma.securityAudit.count()).toBe(0)
  })

  it.each([
    { scope: "workspace", action: "change" },
    { scope: "workspace", action: "remove" },
    { scope: "prototype", action: "change" },
    { scope: "prototype", action: "remove" },
  ] as const)(
    "rejects an editor attempting to $action $scope access without changing grants or audits",
    async ({ scope, action }) => {
      const { prisma, service, store } = await database()
      const actor = await createActor(store, {
        subject: `editor-${scope}-${action}`,
        token: `editor-${scope}-${action}-token`,
      })
      const target = await createActor(store, {
        subject: `editor-${scope}-${action}-target`,
        token: `editor-${scope}-${action}-target-token`,
      })
      const workspace = await prisma.workspace.create({
        data: {
          name: "Workspace",
          createdByUserId: actor.user.id,
          grants: {
            create: [
              { userId: actor.user.id, effect: "allow", role: "editor" },
              { userId: target.user.id, effect: "allow", role: "viewer" },
            ],
          },
        },
      })
      const prototype = await prisma.prototype.create({
        data: {
          name: "Prototype",
          workspaceId: workspace.id,
          createdByUserId: actor.user.id,
          grants: {
            create: {
              userId: target.user.id,
              effect: "allow",
              role: "viewer",
            },
          },
        },
      })

      const operation =
        scope === "workspace"
          ? action === "change"
            ? service.setWorkspaceAccess(
                `editor-${scope}-${action}-token`,
                workspace.id,
                target.user.id,
                { effect: "allow", role: "commenter" },
              )
            : service.removeWorkspaceAccess(
                `editor-${scope}-${action}-token`,
                workspace.id,
                target.user.id,
              )
          : action === "change"
            ? service.setPrototypeAccess(
                `editor-${scope}-${action}-token`,
                prototype.id,
                target.user.id,
                { effect: "allow", role: "commenter" },
              )
            : service.removePrototypeAccess(
                `editor-${scope}-${action}-token`,
                prototype.id,
                target.user.id,
              )

      await expect(operation).rejects.toMatchObject({
        status: 403,
        code: "prototype_access_denied",
      })
      expect(
        await prisma.workspaceAccessGrant.findMany({
          where: { workspaceId: workspace.id },
          orderBy: { userId: "asc" },
          select: { userId: true, effect: true, role: true },
        }),
      ).toEqual(
        [
          { userId: actor.user.id, effect: "allow", role: "editor" },
          { userId: target.user.id, effect: "allow", role: "viewer" },
        ].sort((left, right) => left.userId.localeCompare(right.userId)),
      )
      expect(
        await prisma.prototypeAccessGrant.findMany({
          where: { prototypeId: prototype.id },
          select: { userId: true, effect: true, role: true },
        }),
      ).toEqual([{ userId: target.user.id, effect: "allow", role: "viewer" }])
      expect(await prisma.securityAudit.count()).toBe(0)
    },
  )

  it.each([{ action: "archive" }, { action: "create a version" }] as const)(
    "rejects a commenter attempting to $action without changing product state or audits",
    async ({ action }) => {
      const { prisma, service, store } = await database()
      const token = `commenter-${action.replaceAll(" ", "-")}-token`
      const actor = await createActor(store, {
        subject: `commenter-${action.replaceAll(" ", "-")}`,
        token,
      })
      const workspace = await prisma.workspace.create({
        data: {
          name: "Workspace",
          createdByUserId: actor.user.id,
          grants: {
            create: {
              userId: actor.user.id,
              effect: "allow",
              role: "commenter",
            },
          },
        },
      })
      const prototype = await prisma.prototype.create({
        data: {
          name: "Prototype",
          workspaceId: workspace.id,
          createdByUserId: actor.user.id,
        },
      })

      const operation =
        action === "archive"
          ? service.archivePrototype(token, prototype.id)
          : service.createVersion(token, prototype.id, { label: "Rejected version" })

      await expect(operation).rejects.toMatchObject({
        status: 403,
        code: "prototype_access_denied",
      })
      expect(
        await prisma.prototype.findUnique({
          where: { id: prototype.id },
          select: { archivedAt: true },
        }),
      ).toEqual({ archivedAt: null })
      expect(await prisma.prototypeVersion.count({ where: { prototypeId: prototype.id } })).toBe(0)
      expect(await prisma.securityAudit.count()).toBe(0)
    },
  )

  it.each([
    { scope: "workspace", action: "change" },
    { scope: "workspace", action: "remove" },
    { scope: "prototype", action: "change" },
    { scope: "prototype", action: "remove" },
  ] as const)(
    "rejects stale verification for a $scope access $action without changing access or audits",
    async ({ scope, action }) => {
      const { prisma, service, store } = await database()
      const token = `stale-${scope}-${action}-actor-token`
      const actor = await createActor(store, {
        subject: `stale-${scope}-${action}-actor`,
        token,
        role: "administrator",
      })
      const target = await createActor(store, {
        subject: `stale-${scope}-${action}-target`,
        token: `stale-${scope}-${action}-target-token`,
      })
      const workspace = (await service.createWorkspace(token, {
        name: "Workspace",
      })) as { id: string }
      const prototype = (await service.createPrototype(token, workspace.id, {
        name: "Prototype",
      })) as { id: string }
      await prisma.workspaceAccessGrant.create({
        data: {
          workspaceId: workspace.id,
          userId: target.user.id,
          effect: "allow",
          role: "viewer",
        },
      })
      await prisma.prototypeAccessGrant.create({
        data: {
          prototypeId: prototype.id,
          userId: target.user.id,
          effect: "allow",
          role: "viewer",
        },
      })
      await prisma.session.update({
        where: { id: actor.session.id },
        data: { freshAuthorizedAt: new Date(Date.now() - 5 * 60_000) },
      })

      const operation =
        scope === "workspace"
          ? action === "change"
            ? service.setWorkspaceAccess(token, workspace.id, target.user.id, {
                effect: "allow",
                role: "commenter",
              })
            : service.removeWorkspaceAccess(token, workspace.id, target.user.id)
          : action === "change"
            ? service.setPrototypeAccess(token, prototype.id, target.user.id, {
                effect: "allow",
                role: "commenter",
              })
            : service.removePrototypeAccess(token, prototype.id, target.user.id)

      await expect(operation).rejects.toMatchObject({
        status: 403,
        code: "fresh_authorization_required",
      })
      expect(
        await prisma.workspaceAccessGrant.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: workspace.id,
              userId: target.user.id,
            },
          },
          select: { effect: true, role: true },
        }),
      ).toEqual({ effect: "allow", role: "viewer" })
      expect(
        await prisma.prototypeAccessGrant.findUnique({
          where: {
            prototypeId_userId: {
              prototypeId: prototype.id,
              userId: target.user.id,
            },
          },
          select: { effect: true, role: true },
        }),
      ).toEqual({ effect: "allow", role: "viewer" })
      expect(
        await prisma.securityAudit.count({
          where: { targetUserId: target.user.id },
        }),
      ).toBe(0)
    },
  )

  it.each([
    { scope: "workspace", targetStatus: "unknown" },
    { scope: "workspace", targetStatus: "suspended" },
    { scope: "workspace", targetStatus: "removed" },
    { scope: "prototype", targetStatus: "unknown" },
    { scope: "prototype", targetStatus: "suspended" },
    { scope: "prototype", targetStatus: "removed" },
  ] as const)(
    "rejects a $targetStatus target for a $scope grant without writing access or audits",
    async ({ scope, targetStatus }) => {
      const { prisma, service, store } = await database()
      const token = `inactive-${scope}-${targetStatus}-actor-token`
      await createActor(store, {
        subject: `inactive-${scope}-${targetStatus}-actor`,
        token,
        role: "administrator",
      })
      const workspace = (await service.createWorkspace(token, {
        name: "Workspace",
      })) as { id: string }
      const prototype = (await service.createPrototype(token, workspace.id, {
        name: "Prototype",
      })) as { id: string }
      const targetUserId =
        targetStatus === "unknown"
          ? "00000000-0000-4000-8000-000000000099"
          : (
              await createActor(store, {
                subject: `inactive-${scope}-${targetStatus}-target`,
                token: `inactive-${scope}-${targetStatus}-target-token`,
              })
            ).user.id
      if (targetStatus !== "unknown") {
        await prisma.installationMembership.update({
          where: { userId: targetUserId },
          data:
            targetStatus === "suspended"
              ? { status: "suspended", suspendedAt: new Date(), removedAt: null }
              : { status: "removed", suspendedAt: null, removedAt: new Date() },
        })
      }

      const operation =
        scope === "workspace"
          ? service.setWorkspaceAccess(token, workspace.id, targetUserId, {
              effect: "allow",
              role: "viewer",
            })
          : service.setPrototypeAccess(token, prototype.id, targetUserId, {
              effect: "allow",
              role: "viewer",
            })

      await expect(operation).rejects.toMatchObject({
        status: 422,
        code: "target_user_inactive",
      })
      expect(
        await prisma.workspaceAccessGrant.count({
          where: { workspaceId: workspace.id, userId: targetUserId },
        }),
      ).toBe(0)
      expect(
        await prisma.prototypeAccessGrant.count({
          where: { prototypeId: prototype.id, userId: targetUserId },
        }),
      ).toBe(0)
      expect(await prisma.securityAudit.count({ where: { targetUserId } })).toBe(0)
    },
  )

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

  it("serializes concurrent workspace administrator removal and downgrade", async () => {
    const { prisma, service, store } = await database()
    const first = await createActor(store, {
      subject: "workspace-administrator-one",
      token: "workspace-administrator-one-token",
    })
    const second = await createActor(store, {
      subject: "workspace-administrator-two",
      token: "workspace-administrator-two-token",
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: first.user.id,
        grants: {
          create: [
            {
              userId: first.user.id,
              effect: "allow",
              role: "administrator",
            },
            {
              userId: second.user.id,
              effect: "allow",
              role: "administrator",
            },
          ],
        },
      },
    })
    const lock = await holdWorkspaceLock(prisma, workspace.id)

    const removal = service.removeWorkspaceAccess(
      "workspace-administrator-one-token",
      workspace.id,
      first.user.id,
    )
    await waitForBlockedRowLock(prisma, "workspaces")
    const downgrade = service.setWorkspaceAccess(
      "workspace-administrator-two-token",
      workspace.id,
      second.user.id,
      { effect: "allow", role: "viewer" },
    )
    lock.release()
    await lock.holder
    const results = await Promise.allSettled([removal, downgrade])

    expect(results[0]).toMatchObject({ status: "fulfilled" })
    if (results[1]?.status !== "rejected") throw new Error("The downgrade should be rejected.")
    expect(results[1].reason).toMatchObject({
      status: 409,
      code: "last_workspace_administrator",
    })
    expect(
      await prisma.workspaceAccessGrant.findMany({
        where: { workspaceId: workspace.id, effect: "allow", role: "administrator" },
        select: { userId: true },
      }),
    ).toEqual([{ userId: second.user.id }])
    expect(
      await prisma.securityAudit.findMany({
        where: { workspaceId: workspace.id, event: { startsWith: "workspace.access." } },
        select: { event: true, targetUserId: true },
      }),
    ).toEqual([{ event: "workspace.access.remove", targetUserId: first.user.id }])
  })

  it.each([{ action: "downgrade" }, { action: "remove" }] as const)(
    "rejects a workspace administrator $action that would orphan a child prototype",
    async ({ action }) => {
      const { prisma, service, store } = await database()
      const actor = await createActor(store, {
        subject: `child-guard-${action}-actor`,
        token: `child-guard-${action}-actor-token`,
      })
      const target = await createActor(store, {
        subject: `child-guard-${action}-target`,
        token: `child-guard-${action}-target-token`,
      })
      const workspace = await prisma.workspace.create({
        data: {
          name: "Workspace",
          createdByUserId: actor.user.id,
          grants: {
            create: [
              { userId: actor.user.id, effect: "allow", role: "administrator" },
              { userId: target.user.id, effect: "allow", role: "administrator" },
            ],
          },
        },
      })
      const prototype = await prisma.prototype.create({
        data: {
          name: "Child prototype",
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
      })

      const operation =
        action === "downgrade"
          ? service.setWorkspaceAccess(
              `child-guard-${action}-actor-token`,
              workspace.id,
              target.user.id,
              { effect: "allow", role: "editor" },
            )
          : service.removeWorkspaceAccess(
              `child-guard-${action}-actor-token`,
              workspace.id,
              target.user.id,
            )

      await expect(operation).rejects.toMatchObject({
        status: 409,
        code: "last_prototype_administrator",
      })
      expect(
        await prisma.workspaceAccessGrant.findMany({
          where: { workspaceId: workspace.id },
          orderBy: { userId: "asc" },
          select: { userId: true, effect: true, role: true },
        }),
      ).toEqual(
        [
          { userId: actor.user.id, effect: "allow", role: "administrator" },
          { userId: target.user.id, effect: "allow", role: "administrator" },
        ].sort((left, right) => left.userId.localeCompare(right.userId)),
      )
      expect(
        await prisma.prototypeAccessGrant.findMany({
          where: { prototypeId: prototype.id },
          select: { userId: true, effect: true, role: true },
        }),
      ).toEqual([{ userId: actor.user.id, effect: "allow", role: "viewer" }])
      expect(await prisma.securityAudit.count()).toBe(0)
    },
  )

  it("lets exactly one prototype-direct administrator relinquish authority", async () => {
    const { prisma, service, store } = await database()
    const first = await createActor(store, {
      subject: "prototype-administrator-one",
      token: "prototype-administrator-one-token",
    })
    const second = await createActor(store, {
      subject: "prototype-administrator-two",
      token: "prototype-administrator-two-token",
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: first.user.id,
        grants: {
          create: [
            { userId: first.user.id, effect: "allow", role: "viewer" },
            { userId: second.user.id, effect: "allow", role: "viewer" },
          ],
        },
      },
    })
    const prototype = await prisma.prototype.create({
      data: {
        name: "Prototype",
        workspaceId: workspace.id,
        createdByUserId: first.user.id,
        grants: {
          create: [
            { userId: first.user.id, effect: "allow", role: "administrator" },
            { userId: second.user.id, effect: "allow", role: "administrator" },
          ],
        },
      },
    })
    const lock = await holdPrototypeLock(prisma, prototype.id)

    const removal = service.removePrototypeAccess(
      "prototype-administrator-one-token",
      prototype.id,
      first.user.id,
    )
    await waitForBlockedRowLock(prisma, "prototypes")
    const downgrade = service.setPrototypeAccess(
      "prototype-administrator-two-token",
      prototype.id,
      second.user.id,
      { effect: "allow", role: "viewer" },
    )
    lock.release()
    await lock.holder
    const results = await Promise.allSettled([removal, downgrade])

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1)
    if (results[1]?.status !== "rejected") throw new Error("The downgrade should be rejected.")
    expect(results[1].reason).toMatchObject({
      status: 409,
      code: "last_prototype_administrator",
    })
    expect(
      await prisma.prototypeAccessGrant.findMany({
        where: { prototypeId: prototype.id, effect: "allow", role: "administrator" },
        select: { userId: true },
      }),
    ).toEqual([{ userId: second.user.id }])
    expect(
      await prisma.securityAudit.findMany({
        where: { prototypeId: prototype.id, event: { startsWith: "prototype.access." } },
        select: { event: true, targetUserId: true },
      }),
    ).toEqual([{ event: "prototype.access.remove", targetUserId: first.user.id }])
  })

  it("does not count suspended administrators in workspace or prototype continuity", async () => {
    const { prisma, service, store } = await database()
    const active = await createActor(store, {
      subject: "active-product-administrator",
      token: "active-product-administrator-token",
    })
    const suspended = await createActor(store, {
      subject: "suspended-product-administrator",
      token: "suspended-product-administrator-token",
    })
    const removed = await createActor(store, {
      subject: "removed-product-administrator",
      token: "removed-product-administrator-token",
    })
    await store.lock((records) =>
      records.saveMembership({
        userId: suspended.user.id,
        status: "suspended",
        role: "member",
        source: "manual",
        suspendedAt: new Date(),
      }),
    )
    await store.lock((records) =>
      records.saveMembership({
        userId: removed.user.id,
        status: "removed",
        role: "member",
        source: "manual",
        removedAt: new Date(),
      }),
    )
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: active.user.id,
        grants: {
          create: [
            { userId: active.user.id, effect: "allow", role: "administrator" },
            { userId: suspended.user.id, effect: "allow", role: "administrator" },
            { userId: removed.user.id, effect: "allow", role: "administrator" },
          ],
        },
      },
    })
    const prototypeWorkspace = await prisma.workspace.create({
      data: {
        name: "Prototype workspace",
        createdByUserId: active.user.id,
        grants: {
          create: [
            { userId: active.user.id, effect: "allow", role: "viewer" },
            { userId: suspended.user.id, effect: "allow", role: "viewer" },
            { userId: removed.user.id, effect: "allow", role: "viewer" },
          ],
        },
      },
    })
    const prototype = await prisma.prototype.create({
      data: {
        name: "Prototype",
        workspaceId: prototypeWorkspace.id,
        createdByUserId: active.user.id,
        grants: {
          create: [
            { userId: active.user.id, effect: "allow", role: "administrator" },
            { userId: suspended.user.id, effect: "allow", role: "administrator" },
            { userId: removed.user.id, effect: "allow", role: "administrator" },
          ],
        },
      },
    })

    await expect(
      service.removeWorkspaceAccess(
        "active-product-administrator-token",
        workspace.id,
        active.user.id,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "last_workspace_administrator",
    })
    await expect(
      service.removePrototypeAccess(
        "active-product-administrator-token",
        prototype.id,
        active.user.id,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "last_prototype_administrator",
    })
  })

  it.each([
    { scope: "workspace", action: "change" },
    { scope: "workspace", action: "remove" },
    { scope: "prototype", action: "change" },
    { scope: "prototype", action: "remove" },
  ] as const)(
    "does not let an uppercase UUID bypass the final $scope administrator check on $action",
    async ({ scope, action }) => {
      const { prisma, service, store } = await database()
      const token = `uppercase-${scope}-${action}-token`
      const actor = await createActor(store, {
        subject: `uppercase-${scope}-${action}`,
        token,
      })
      const workspace = await prisma.workspace.create({
        data: {
          name: "Workspace",
          createdByUserId: actor.user.id,
          grants: {
            create: {
              userId: actor.user.id,
              effect: "allow",
              role: scope === "workspace" ? "administrator" : "viewer",
            },
          },
        },
      })
      const prototype = await prisma.prototype.create({
        data: {
          name: "Prototype",
          workspaceId: workspace.id,
          createdByUserId: actor.user.id,
          grants:
            scope === "prototype"
              ? {
                  create: {
                    userId: actor.user.id,
                    effect: "allow",
                    role: "administrator",
                  },
                }
              : undefined,
        },
      })
      const uppercaseUserId = actor.user.id.toUpperCase()

      const operation =
        scope === "workspace"
          ? action === "change"
            ? service.setWorkspaceAccess(token, workspace.id, uppercaseUserId, {
                effect: "allow",
                role: "viewer",
              })
            : service.removeWorkspaceAccess(token, workspace.id, uppercaseUserId)
          : action === "change"
            ? service.setPrototypeAccess(token, prototype.id, uppercaseUserId, {
                effect: "allow",
                role: "viewer",
              })
            : service.removePrototypeAccess(token, prototype.id, uppercaseUserId)

      await expect(operation).rejects.toMatchObject({
        status: 409,
        code:
          scope === "workspace" ? "last_workspace_administrator" : "last_prototype_administrator",
      })
      expect(
        await prisma.workspaceAccessGrant.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: workspace.id,
              userId: actor.user.id,
            },
          },
          select: { effect: true, role: true },
        }),
      ).toEqual({
        effect: "allow",
        role: scope === "workspace" ? "administrator" : "viewer",
      })
      expect(
        await prisma.prototypeAccessGrant.findUnique({
          where: {
            prototypeId_userId: {
              prototypeId: prototype.id,
              userId: actor.user.id,
            },
          },
          select: { effect: true, role: true },
        }),
      ).toEqual(scope === "prototype" ? { effect: "allow", role: "administrator" } : null)
      expect(
        await prisma.securityAudit.count({
          where: { event: { startsWith: `${scope}.access.` } },
        }),
      ).toBe(0)
    },
  )

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

  it("commits one concurrent archive and returns one archived conflict", async () => {
    const { prisma, service, store } = await database()
    const actor = await createActor(store, {
      subject: "concurrent-archive",
      token: "concurrent-archive-token",
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: actor.user.id,
        grants: {
          create: {
            userId: actor.user.id,
            effect: "allow",
            role: "editor",
          },
        },
      },
    })
    const prototype = await prisma.prototype.create({
      data: {
        name: "Prototype",
        workspaceId: workspace.id,
        createdByUserId: actor.user.id,
      },
    })
    const lock = await holdPrototypeLock(prisma, prototype.id)

    const first = service.archivePrototype("concurrent-archive-token", prototype.id)
    await waitForBlockedRowLock(prisma, "prototypes")
    const second = service.archivePrototype("concurrent-archive-token", prototype.id)
    lock.release()
    await lock.holder
    const results = await Promise.allSettled([first, second])

    expect(results[0]).toMatchObject({ status: "fulfilled" })
    if (results[1]?.status !== "rejected") throw new Error("The second archive should be rejected.")
    expect(results[1].reason).toMatchObject({
      status: 409,
      code: "prototype_archived",
    })
    expect(
      await prisma.securityAudit.findMany({
        where: { prototypeId: prototype.id, event: "prototype.archive" },
        select: { event: true },
      }),
    ).toEqual([{ event: "prototype.archive" }])
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

  it.each([
    {
      resource: "malformed workspace",
      operation: (service: ReturnType<typeof createPrototypeAuthorizationService>, token: string) =>
        service.listPrototypes(token, "not-a-workspace-id", {}),
      code: "workspace_not_found",
    },
    {
      resource: "missing prototype",
      operation: (service: ReturnType<typeof createPrototypeAuthorizationService>, token: string) =>
        service.listVersions(token, "00000000-0000-4000-8000-000000000099", {}),
      code: "prototype_not_found",
    },
  ])("returns a resource 404 for a $resource path ID", async ({ operation, code }) => {
    const { service, store } = await database()
    await createActor(store, {
      subject: `path-${code}`,
      token: `path-${code}-token`,
    })

    await expect(operation(service, `path-${code}-token`)).rejects.toMatchObject({
      status: 404,
      code,
    })
  })

  it("continues workspace pagination after access to the prior cursor is revoked", async () => {
    const { prisma, service, store } = await database()
    const actor = await createActor(store, {
      subject: "workspace-revoked-cursor",
      token: "workspace-revoked-cursor-token",
    })
    const workspaceIds = [
      "00000000-0000-4000-8000-000000000011",
      "00000000-0000-4000-8000-000000000012",
      "00000000-0000-4000-8000-000000000013",
    ]
    for (const id of workspaceIds) {
      await prisma.workspace.create({
        data: {
          id,
          name: `Workspace ${id.at(-1)}`,
          createdByUserId: actor.user.id,
          grants: {
            create: {
              userId: actor.user.id,
              effect: "allow",
              role: "viewer",
            },
          },
        },
      })
    }

    const first = (await service.listWorkspaces("workspace-revoked-cursor-token", {
      limit: 1,
    })) as { items: { id: string }[]; nextCursor: string | null }
    await prisma.workspaceAccessGrant.delete({
      where: {
        workspaceId_userId: {
          workspaceId: workspaceIds[0]!,
          userId: actor.user.id,
        },
      },
    })
    const second = (await service.listWorkspaces("workspace-revoked-cursor-token", {
      limit: 1,
      cursor: first.nextCursor,
    })) as { items: { id: string }[]; nextCursor: string | null }

    expect(first.items.map(({ id }) => id)).toEqual([workspaceIds[0]])
    expect(second.items.map(({ id }) => id)).toEqual([workspaceIds[1]])
    expect(second.nextCursor).toBe(workspaceIds[1])
  })

  it("returns scalar workspaces without inaccessible prototype or grant metadata", async () => {
    const { prisma, service, store } = await database()
    const actor = await createActor(store, {
      subject: "workspace-list-leak",
      token: "workspace-list-leak-token",
    })
    const other = await createActor(store, {
      subject: "workspace-list-other",
      token: "workspace-list-other-token",
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: actor.user.id,
        grants: {
          create: {
            userId: actor.user.id,
            effect: "allow",
            role: "viewer",
          },
        },
        prototypes: {
          create: {
            name: "Denied prototype",
            createdByUserId: other.user.id,
            grants: {
              create: {
                userId: actor.user.id,
                effect: "deny",
              },
            },
          },
        },
      },
    })

    const page = (await service.listWorkspaces("workspace-list-leak-token", {})) as {
      items: Record<string, unknown>[]
    }

    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      id: workspace.id,
      createdByUserId: actor.user.id,
      name: "Workspace",
    })
    expect(page.items[0]?.createdAt).toBeInstanceOf(Date)
    expect(page.items[0]?.updatedAt).toBeInstanceOf(Date)
    expect(page.items[0]).not.toHaveProperty("prototypes")
    expect(page.items[0]).not.toHaveProperty("grants")
    expect(JSON.stringify(page)).not.toContain("Denied prototype")
  })

  it("returns an empty terminal prototype page for a prototype-only user", async () => {
    const { prisma, service, store } = await database()
    const actor = await createActor(store, {
      subject: "prototype-only-terminal",
      token: "prototype-only-terminal-token",
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: actor.user.id,
      },
    })
    const prototype = await prisma.prototype.create({
      data: {
        name: "Prototype",
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
    })

    await expect(
      service.listPrototypes("prototype-only-terminal-token", workspace.id, {
        cursor: prototype.id,
        limit: 20,
      }),
    ).resolves.toEqual({ items: [], nextCursor: null })
  })

  it("returns an empty terminal prototype page for a baseline-authorized user", async () => {
    const baselineAccess = vi.fn<PrototypeBaselinePolicy["baseline"]>().mockResolvedValue({
      role: "viewer",
      repositorySourceId: "repository-source",
      githubRepositoryId: "100",
      rawPermission: "read",
      confirmedAt: new Date(),
      synchronizationStatus: "current",
    })
    const baseline: PrototypeBaselinePolicy = {
      baseline: baselineAccess,
    }
    const { prisma, service, store } = await database(baseline)
    const actor = await createActor(store, {
      subject: "baseline-terminal",
      token: "baseline-terminal-token",
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: actor.user.id,
      },
    })
    const prototype = await prisma.prototype.create({
      data: {
        name: "Prototype",
        workspaceId: workspace.id,
        createdByUserId: actor.user.id,
      },
    })

    await expect(
      service.listPrototypes("baseline-terminal-token", workspace.id, {
        cursor: prototype.id,
        limit: 20,
      }),
    ).resolves.toEqual({ items: [], nextCursor: null })
    expect(baselineAccess.mock.calls).toContainEqual([prisma, actor.user.id, prototype.id])
  })

  it("uses baseline authorization for single-prototype reads and role-gated mutations", async () => {
    const baselineAccess = vi.fn<PrototypeBaselinePolicy["baseline"]>().mockResolvedValue({
      role: "administrator",
      repositorySourceId: "repository-source",
      githubRepositoryId: "100",
      rawPermission: "admin",
      confirmedAt: new Date(),
      synchronizationStatus: "current",
    })
    const { prisma, service, store } = await database({ baseline: baselineAccess })
    const actor = await createActor(store, {
      subject: "baseline-single-prototype",
      token: "baseline-single-prototype-token",
    })
    const owner = await createActor(store, {
      subject: "baseline-single-prototype-owner",
      token: "baseline-single-prototype-owner-token",
    })
    const target = await createActor(store, {
      subject: "baseline-single-prototype-target",
      token: "baseline-single-prototype-target-token",
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: owner.user.id,
        grants: {
          create: {
            userId: owner.user.id,
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
        createdByUserId: owner.user.id,
      },
    })
    const firstVersion = await prisma.prototypeVersion.create({
      data: {
        prototypeId: prototype.id,
        createdByUserId: owner.user.id,
        sequence: 1,
        label: "First",
      },
    })

    await expect(
      service.getPrototype("baseline-single-prototype-token", prototype.id),
    ).resolves.toMatchObject({ id: prototype.id })
    await expect(
      service.explainPrototypeAccess("baseline-single-prototype-token", prototype.id),
    ).resolves.toMatchObject({
      allowed: true,
      role: "administrator",
      source: "github-synchronized",
    })
    await expect(
      service.listVersions("baseline-single-prototype-token", prototype.id, {}),
    ).resolves.toMatchObject({ items: [{ id: firstVersion.id }] })
    await expect(
      service.getVersion("baseline-single-prototype-token", prototype.id, firstVersion.id),
    ).resolves.toMatchObject({ id: firstVersion.id })
    await expect(
      service.createVersion("baseline-single-prototype-token", prototype.id, {
        label: "Second",
      }),
    ).resolves.toMatchObject({ sequence: 2 })
    await expect(
      service.setPrototypeAccess("baseline-single-prototype-token", prototype.id, target.user.id, {
        effect: "allow",
        role: "viewer",
      }),
    ).resolves.toMatchObject({ role: "viewer" })
    await expect(
      service.removePrototypeAccess(
        "baseline-single-prototype-token",
        prototype.id,
        target.user.id,
      ),
    ).resolves.toBeUndefined()
    const archived = (await service.archivePrototype(
      "baseline-single-prototype-token",
      prototype.id,
    )) as { archivedAt: Date | null }
    expect(archived.archivedAt).toBeInstanceOf(Date)

    expect(baselineAccess.mock.calls.length).toBeGreaterThanOrEqual(8)
    expect(
      baselineAccess.mock.calls.every(
        ([database, userId, prototypeId]) =>
          database && userId === actor.user.id && prototypeId === prototype.id,
      ),
    ).toBe(true)
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
  })

  it("short-circuits the baseline for explicit prototype roles and denies", async () => {
    const baselineAccess = vi
      .fn<PrototypeBaselinePolicy["baseline"]>()
      .mockRejectedValue(new Error("baseline unavailable"))
    const { prisma, service, store } = await database({ baseline: baselineAccess })
    const actor = await createActor(store, {
      subject: "single-prototype-short-circuit",
      token: "single-prototype-short-circuit-token",
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: actor.user.id,
      },
    })
    const [allowed, denied] = await Promise.all([
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
          name: "Denied",
          workspaceId: workspace.id,
          createdByUserId: actor.user.id,
          grants: {
            create: {
              userId: actor.user.id,
              effect: "deny",
            },
          },
        },
      }),
    ])

    await expect(
      service.getPrototype("single-prototype-short-circuit-token", allowed.id),
    ).resolves.toMatchObject({ id: allowed.id })
    await expect(
      service.getPrototype("single-prototype-short-circuit-token", denied.id),
    ).rejects.toMatchObject({
      status: 403,
      code: "prototype_access_denied",
    })
    await expect(
      service.explainPrototypeAccess("single-prototype-short-circuit-token", denied.id),
    ).resolves.toMatchObject({
      allowed: false,
      source: "hub-prototype",
    })
    expect(baselineAccess).not.toHaveBeenCalled()
  })

  it("lets a workspace deny override prototype and baseline access when listing", async () => {
    const baselineAccess = vi
      .fn<PrototypeBaselinePolicy["baseline"]>()
      .mockRejectedValue(new Error("baseline unavailable"))
    const baseline: PrototypeBaselinePolicy = {
      baseline: baselineAccess,
    }
    const { prisma, service, store } = await database(baseline)
    const actor = await createActor(store, {
      subject: "workspace-denied-prototype-list",
      token: "workspace-denied-prototype-list-token",
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: actor.user.id,
        grants: {
          create: {
            userId: actor.user.id,
            effect: "deny",
          },
        },
      },
    })
    await prisma.prototype.create({
      data: {
        name: "Directly allowed prototype",
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
    })
    const prototypeScan = vi.spyOn(prisma.prototype, "findMany")

    await expect(
      service.listPrototypes("workspace-denied-prototype-list-token", workspace.id, {}),
    ).rejects.toMatchObject({
      status: 403,
      code: "prototype_access_denied",
    })
    expect(prototypeScan).not.toHaveBeenCalled()
    expect(baselineAccess.mock.calls).toHaveLength(0)
  })

  it("uses an explicit prototype role without consulting a failing baseline", async () => {
    const baselineAccess = vi
      .fn<PrototypeBaselinePolicy["baseline"]>()
      .mockRejectedValue(new Error("baseline unavailable"))
    const { prisma, service, store } = await database({ baseline: baselineAccess })
    const actor = await createActor(store, {
      subject: "explicit-role-baseline-failure",
      token: "explicit-role-baseline-failure-token",
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: actor.user.id,
      },
    })
    const prototype = await prisma.prototype.create({
      data: {
        name: "Prototype",
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
    })

    const page = (await service.listPrototypes(
      "explicit-role-baseline-failure-token",
      workspace.id,
      {},
    )) as { items: Record<string, unknown>[]; nextCursor: string | null }
    expect(page).toMatchObject({
      items: [{ id: prototype.id }],
      nextCursor: null,
    })
    expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(
      [
        "archivedAt",
        "authorizationMode",
        "createdAt",
        "createdByUserId",
        "id",
        "name",
        "sourceRepositoryId",
        "updatedAt",
        "workspaceId",
      ].sort(),
    )
    expect(baselineAccess.mock.calls).toHaveLength(0)
  })

  it("makes synchronized memberships manual when granting workspace or prototype administration", async () => {
    const { prisma, service, store } = await database()
    const actor = await createActor(store, {
      subject: "administration-actor",
      token: "administration-actor-token",
      role: "administrator",
    })
    const workspaceTarget = await createActor(store, {
      subject: "workspace-administrator-target",
      token: "workspace-administrator-target-token",
      source: "synchronized",
    })
    const prototypeTarget = await createActor(store, {
      subject: "prototype-administrator-target",
      token: "prototype-administrator-target-token",
      source: "synchronized",
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: actor.user.id,
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
        createdByUserId: actor.user.id,
        grants: {
          create: {
            userId: actor.user.id,
            effect: "allow",
            role: "administrator",
          },
        },
      },
    })

    await service.setWorkspaceAccess(
      "administration-actor-token",
      workspace.id,
      workspaceTarget.user.id,
      { effect: "allow", role: "administrator" },
    )
    await service.setPrototypeAccess(
      "administration-actor-token",
      prototype.id,
      prototypeTarget.user.id,
      { effect: "allow", role: "administrator" },
    )

    expect(
      await prisma.installationMembership.findUnique({
        where: { userId: workspaceTarget.user.id },
      }),
    ).toMatchObject({ source: "manual", status: "active" })
    expect(
      await prisma.installationMembership.findUnique({
        where: { userId: prototypeTarget.user.id },
      }),
    ).toMatchObject({ source: "manual", status: "active" })
    expect(
      await prisma.securityAudit.findMany({
        where: { event: "membership.synchronized.preserve" },
        orderBy: { createdAt: "asc" },
      }),
    ).toEqual([
      expect.objectContaining({
        actorUserId: actor.user.id,
        sessionId: actor.session.id,
        authenticationProviderRevisionId: actor.session.authenticationProviderRevisionId,
        targetMembershipId: workspaceTarget.membership.id,
        targetUserId: workspaceTarget.user.id,
        context: { reason: "product_administration" },
      }),
      expect.objectContaining({
        actorUserId: actor.user.id,
        sessionId: actor.session.id,
        authenticationProviderRevisionId: actor.session.authenticationProviderRevisionId,
        targetMembershipId: prototypeTarget.membership.id,
        targetUserId: prototypeTarget.user.id,
        context: { reason: "product_administration" },
      }),
    ])
  })

  it("passes the mutation transaction to a synchronized prototype baseline", async () => {
    const baselineAccess = vi.fn<PrototypeBaselinePolicy["baseline"]>().mockResolvedValue({
      role: "editor",
      repositorySourceId: "repository-source",
      githubRepositoryId: "100",
      rawPermission: "write",
      confirmedAt: new Date(),
      synchronizationStatus: "current",
    })
    const { prisma, service, store } = await database({ baseline: baselineAccess })
    const actor = await createActor(store, {
      subject: "transaction-baseline",
      token: "transaction-baseline-token",
    })
    const workspace = await prisma.workspace.create({
      data: { name: "Workspace", createdByUserId: actor.user.id },
    })
    const prototype = await prisma.prototype.create({
      data: {
        name: "Prototype",
        workspaceId: workspace.id,
        createdByUserId: actor.user.id,
      },
    })

    await expect(
      service.createVersion("transaction-baseline-token", prototype.id, {
        label: "Baseline version",
      }),
    ).resolves.toMatchObject({ prototypeId: prototype.id, sequence: 1 })

    expect(baselineAccess).toHaveBeenCalledOnce()
    expect(baselineAccess.mock.calls[0]?.slice(1)).toEqual([actor.user.id, prototype.id])
    expect(baselineAccess.mock.calls[0]?.[0]).not.toBe(prisma)
  })

  it("does not evaluate prototype baselines in unrelated workspaces while listing workspaces", async () => {
    const baselineAccess = vi.fn<PrototypeBaselinePolicy["baseline"]>().mockResolvedValue({
      role: "viewer",
      repositorySourceId: "repository-source",
      githubRepositoryId: "100",
      rawPermission: "read",
      confirmedAt: new Date(),
      synchronizationStatus: "current",
    })
    const baselineWorkspaceIds = vi.fn<NonNullable<PrototypeBaselinePolicy["workspaceIds"]>>()
    const { prisma, service, store } = await database({
      baseline: baselineAccess,
      workspaceIds: baselineWorkspaceIds,
    })
    const actor = await createActor(store, {
      subject: "workspace-baseline-scope",
      token: "workspace-baseline-scope-token",
    })
    const accessibleWorkspace = await prisma.workspace.create({
      data: {
        name: "Accessible workspace",
        createdByUserId: actor.user.id,
        prototypes: {
          create: {
            name: "Accessible prototype",
            createdByUserId: actor.user.id,
          },
        },
      },
      include: { prototypes: true },
    })
    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        prisma.workspace.create({
          data: {
            name: `Unrelated workspace ${index}`,
            createdByUserId: actor.user.id,
            prototypes: {
              create: {
                name: `Unrelated prototype ${index}`,
                createdByUserId: actor.user.id,
              },
            },
          },
        }),
      ),
    )
    baselineWorkspaceIds.mockResolvedValue([accessibleWorkspace.id])

    await expect(
      service.listWorkspaces("workspace-baseline-scope-token", {}),
    ).resolves.toMatchObject({
      items: [{ id: accessibleWorkspace.id }],
      nextCursor: null,
    })
    expect(baselineWorkspaceIds).toHaveBeenCalledWith(prisma, actor.user.id)
    expect(baselineAccess.mock.calls).toEqual([
      [prisma, actor.user.id, accessibleWorkspace.prototypes[0]!.id],
    ])
  })

  it("uses batched baseline prototype IDs without per-prototype authorization queries", async () => {
    const baselineAccess = vi.fn<PrototypeBaselinePolicy["baseline"]>().mockResolvedValue({
      role: "viewer",
      repositorySourceId: "repository-source",
      githubRepositoryId: "100",
      rawPermission: "read",
      confirmedAt: new Date(),
      synchronizationStatus: "current",
    })
    const baselinePrototypeIds = vi.fn<NonNullable<PrototypeBaselinePolicy["prototypeIds"]>>()
    const { prisma, service, store } = await database({
      baseline: baselineAccess,
      prototypeIds: baselinePrototypeIds,
    })
    const actor = await createActor(store, {
      subject: "prototype-baseline-batch",
      token: "prototype-baseline-batch-token",
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: actor.user.id,
      },
    })
    const directId = "00000000-0000-4000-8000-000000000010"
    const baselineId = "00000000-0000-4000-8000-000000000020"
    await prisma.prototype.createMany({
      data: [
        {
          id: directId,
          name: "Direct",
          workspaceId: workspace.id,
          createdByUserId: actor.user.id,
        },
        {
          id: baselineId,
          name: "Synchronized",
          workspaceId: workspace.id,
          createdByUserId: actor.user.id,
        },
        ...Array.from({ length: 5 }, (_, index) => ({
          id: `00000000-0000-4000-8000-00000000010${index}`,
          name: `Unrelated ${index}`,
          workspaceId: workspace.id,
          createdByUserId: actor.user.id,
        })),
      ],
    })
    await prisma.prototypeAccessGrant.create({
      data: {
        prototypeId: directId,
        userId: actor.user.id,
        effect: "allow",
        role: "viewer",
      },
    })
    baselinePrototypeIds.mockResolvedValue([baselineId])
    const prototypePageQueries = vi.spyOn(prisma.prototype, "findMany")
    const anyPrototypeQueries = vi.spyOn(prisma.prototype, "findFirst")

    await expect(
      service.getWorkspace("prototype-baseline-batch-token", workspace.id),
    ).resolves.toMatchObject({ id: workspace.id })
    await expect(
      service.listPrototypes("prototype-baseline-batch-token", workspace.id, {}),
    ).resolves.toMatchObject({
      items: [{ id: directId }, { id: baselineId }],
      nextCursor: null,
    })

    expect(baselinePrototypeIds).toHaveBeenCalledTimes(3)
    expect(
      baselinePrototypeIds.mock.calls.every(
        ([database, userId, workspaceId]) =>
          database === prisma && userId === actor.user.id && workspaceId === workspace.id,
      ),
    ).toBe(true)
    expect(baselineAccess).toHaveBeenCalledOnce()
    expect(baselineAccess).toHaveBeenCalledWith(prisma, actor.user.id, baselineId)
    const anyQuery = JSON.stringify(anyPrototypeQueries.mock.calls[0]?.[0])
    expect(anyQuery).toContain(workspace.id)
    expect(anyQuery).toContain(actor.user.id)
    expect(anyQuery).toContain(baselineId)
    expect(prototypePageQueries).toHaveBeenCalledOnce()
    const pageQuery = JSON.stringify(prototypePageQueries.mock.calls[0]?.[0])
    expect(pageQuery).toContain(workspace.id)
    expect(pageQuery).toContain(actor.user.id)
    expect(pageQuery).toContain(baselineId)
  })

  it("gets a workspace through prototype or baseline access while an explicit workspace deny wins", async () => {
    const baselineUsers = new Set<string>()
    const baselineAccess = vi
      .fn<PrototypeBaselinePolicy["baseline"]>()
      .mockImplementation((_database, userId) =>
        Promise.resolve(
          baselineUsers.has(userId)
            ? {
                role: "viewer",
                repositorySourceId: "repository-source",
                githubRepositoryId: "100",
                rawPermission: "read",
                confirmedAt: new Date(),
                synchronizationStatus: "current",
              }
            : null,
        ),
      )
    const { prisma, service, store } = await database({ baseline: baselineAccess })
    const prototypeOnly = await createActor(store, {
      subject: "workspace-prototype-only",
      token: "workspace-prototype-only-token",
    })
    const synchronized = await createActor(store, {
      subject: "workspace-synchronized",
      token: "workspace-synchronized-token",
    })
    const denied = await createActor(store, {
      subject: "workspace-denied",
      token: "workspace-denied-token",
    })
    baselineUsers.add(synchronized.user.id)
    baselineUsers.add(denied.user.id)
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: prototypeOnly.user.id,
        grants: {
          create: {
            userId: denied.user.id,
            effect: "deny",
          },
        },
        prototypes: {
          create: {
            name: "Prototype",
            createdByUserId: prototypeOnly.user.id,
            grants: {
              create: {
                userId: prototypeOnly.user.id,
                effect: "allow",
                role: "viewer",
              },
            },
          },
        },
      },
    })

    await expect(
      service.getWorkspace("workspace-prototype-only-token", workspace.id),
    ).resolves.toMatchObject({ id: workspace.id })
    await expect(
      service.getWorkspace("workspace-synchronized-token", workspace.id),
    ).resolves.toMatchObject({ id: workspace.id })
    await expect(
      service.getWorkspace("workspace-denied-token", workspace.id),
    ).rejects.toMatchObject({
      status: 403,
      code: "prototype_access_denied",
    })
  })

  it("fills prototype pages after excluding explicit denies and continues without duplicates", async () => {
    const { prisma, service, store } = await database()
    const actor = await createActor(store, {
      subject: "prototype-pagination",
      token: "prototype-pagination-token",
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: actor.user.id,
        grants: {
          create: {
            userId: actor.user.id,
            effect: "allow",
            role: "viewer",
          },
        },
      },
    })
    const prototypeIds = [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000004",
      "00000000-0000-4000-8000-000000000005",
      "00000000-0000-4000-8000-000000000006",
    ]
    await prisma.prototype.createMany({
      data: prototypeIds.map((id) => ({
        id,
        name: `Prototype ${id.at(-1)}`,
        workspaceId: workspace.id,
        createdByUserId: actor.user.id,
      })),
    })
    await prisma.prototypeAccessGrant.createMany({
      data: [prototypeIds[1], prototypeIds[4]].map((prototypeId) => ({
        prototypeId: prototypeId!,
        userId: actor.user.id,
        effect: "deny",
      })),
    })

    const first = (await service.listPrototypes("prototype-pagination-token", workspace.id, {
      limit: 2,
    })) as { items: { id: string }[]; nextCursor: string | null }
    const second = (await service.listPrototypes("prototype-pagination-token", workspace.id, {
      limit: 2,
      cursor: first.nextCursor,
    })) as { items: { id: string }[]; nextCursor: string | null }

    expect(first.items.map(({ id }) => id)).toEqual([prototypeIds[0], prototypeIds[2]])
    expect(first.nextCursor).toBe(prototypeIds[2])
    expect(second.items.map(({ id }) => id)).toEqual([prototypeIds[3], prototypeIds[5]])
    expect(second.nextCursor).toBeNull()
    expect(new Set([...first.items, ...second.items].map(({ id }) => id)).size).toBe(4)
  })
  it("rejects a prototype cursor from another workspace", async () => {
    const { prisma, service, store } = await database()
    const actor = await createActor(store, {
      subject: "cross-workspace-cursor",
      token: "cross-workspace-cursor-token",
    })
    const workspaces = await Promise.all(
      ["First workspace", "Second workspace"].map((name) =>
        prisma.workspace.create({
          data: {
            name,
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
    const firstWorkspacePrototypeIds = [
      "00000000-0000-4000-8000-000000000011",
      "00000000-0000-4000-8000-000000000013",
    ]
    await prisma.prototype.createMany({
      data: [
        ...firstWorkspacePrototypeIds.map((id) => ({
          id,
          name: `First workspace prototype ${id.at(-1)}`,
          workspaceId: workspaces[0]!.id,
          createdByUserId: actor.user.id,
        })),
        {
          id: "00000000-0000-4000-8000-000000000012",
          name: "Foreign cursor prototype",
          workspaceId: workspaces[1]!.id,
          createdByUserId: actor.user.id,
        },
      ],
    })

    await expect(
      service.listPrototypes("cross-workspace-cursor-token", workspaces[0]!.id, {
        cursor: "00000000-0000-4000-8000-000000000012",
        limit: 1,
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: "invalid_pagination",
    })
    const page = (await service.listPrototypes(
      "cross-workspace-cursor-token",
      workspaces[0]!.id,
      {},
    )) as { items: { id: string }[] }
    expect(page.items.map(({ id }) => id)).toEqual(firstWorkspacePrototypeIds)
  })
  it("accepts a scoped prototype cursor with an uppercase workspace ID", async () => {
    const { prisma, service, store } = await database()
    const actor = await createActor(store, {
      subject: "uppercase-workspace-cursor",
      token: "uppercase-workspace-cursor-token",
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: actor.user.id,
        grants: {
          create: {
            userId: actor.user.id,
            effect: "allow",
            role: "viewer",
          },
        },
      },
    })
    const prototypes = await Promise.all(
      [
        { id: "00000000-0000-4000-8000-000000000031", name: "First" },
        { id: "00000000-0000-4000-8000-000000000032", name: "Second" },
      ].map(({ id, name }) =>
        prisma.prototype.create({
          data: {
            id,
            name,
            workspaceId: workspace.id,
            createdByUserId: actor.user.id,
          },
        }),
      ),
    )

    await expect(
      service.listPrototypes("uppercase-workspace-cursor-token", workspace.id.toUpperCase(), {
        cursor: prototypes[0]!.id,
        limit: 1,
      }),
    ).resolves.toMatchObject({
      items: [{ id: prototypes[1]!.id }],
      nextCursor: null,
    })
  })

  it("does not reveal prototype cursor ownership to an unauthorized member", async () => {
    const { prisma, service, store } = await database()
    const owner = await createActor(store, {
      subject: "cursor-owner",
      token: "cursor-owner-token",
    })
    await createActor(store, {
      subject: "cursor-outsider",
      token: "cursor-outsider-token",
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: owner.user.id,
      },
    })
    const prototype = await prisma.prototype.create({
      data: {
        name: "Prototype",
        workspaceId: workspace.id,
        createdByUserId: owner.user.id,
      },
    })

    for (const cursor of [prototype.id, "00000000-0000-4000-8000-000000000099"]) {
      await expect(
        service.listPrototypes("cursor-outsider-token", workspace.id, { cursor }),
      ).rejects.toMatchObject({
        status: 403,
        code: "prototype_access_denied",
      })
    }
  })
  it("lists immutable versions by sequence and paginates in that order", async () => {
    const { prisma, service, store } = await database()
    const actor = await createActor(store, {
      subject: "version-sequence-pagination",
      token: "version-sequence-pagination-token",
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: actor.user.id,
        grants: {
          create: {
            userId: actor.user.id,
            effect: "allow",
            role: "viewer",
          },
        },
      },
    })
    const prototype = await prisma.prototype.create({
      data: {
        name: "Prototype",
        workspaceId: workspace.id,
        createdByUserId: actor.user.id,
      },
    })
    const versions = [
      {
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        sequence: 1,
        label: "First immutable version",
      },
      {
        id: "00000000-0000-4000-8000-000000000001",
        sequence: 2,
        label: "Second immutable version",
      },
      {
        id: "11111111-1111-4111-8111-111111111111",
        sequence: 3,
        label: "Third immutable version",
      },
    ]
    await prisma.prototypeVersion.createMany({
      data: versions.map((version) => ({
        ...version,
        prototypeId: prototype.id,
        createdByUserId: actor.user.id,
      })),
    })

    const first = (await service.listVersions("version-sequence-pagination-token", prototype.id, {
      limit: 2,
    })) as {
      items: { id: string; sequence: number; label: string | null }[]
      nextCursor: string | null
    }
    const second = (await service.listVersions("version-sequence-pagination-token", prototype.id, {
      limit: 2,
      cursor: first.nextCursor,
    })) as {
      items: { id: string; sequence: number; label: string | null }[]
      nextCursor: string | null
    }

    expect(first.items.map(({ sequence, label }) => ({ sequence, label }))).toEqual([
      { sequence: 1, label: "First immutable version" },
      { sequence: 2, label: "Second immutable version" },
    ])
    expect(first.nextCursor).toBe(versions[1]?.id)
    expect(second.items.map(({ sequence, label }) => ({ sequence, label }))).toEqual([
      { sequence: 3, label: "Third immutable version" },
    ])
    expect(second.nextCursor).toBeNull()
  })
  it("rejects a version cursor from another prototype", async () => {
    const { prisma, service, store } = await database()
    const actor = await createActor(store, {
      subject: "cross-prototype-cursor",
      token: "cross-prototype-cursor-token",
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: actor.user.id,
        grants: {
          create: {
            userId: actor.user.id,
            effect: "allow",
            role: "viewer",
          },
        },
      },
    })
    const prototypes = await Promise.all(
      ["First prototype", "Second prototype"].map((name) =>
        prisma.prototype.create({
          data: {
            name,
            workspaceId: workspace.id,
            createdByUserId: actor.user.id,
          },
        }),
      ),
    )
    const firstPrototypeVersionIds = [
      "00000000-0000-4000-8000-000000000021",
      "00000000-0000-4000-8000-000000000022",
    ]
    await prisma.prototypeVersion.createMany({
      data: [
        {
          id: firstPrototypeVersionIds[0],
          prototypeId: prototypes[0]!.id,
          createdByUserId: actor.user.id,
          sequence: 1,
          label: "First version",
        },
        {
          id: firstPrototypeVersionIds[1],
          prototypeId: prototypes[0]!.id,
          createdByUserId: actor.user.id,
          sequence: 2,
          label: "Second version",
        },
      ],
    })
    const foreignVersion = await prisma.prototypeVersion.create({
      data: {
        prototypeId: prototypes[1]!.id,
        createdByUserId: actor.user.id,
        sequence: 1,
        label: "Foreign cursor version",
      },
    })

    await expect(
      service.listVersions("cross-prototype-cursor-token", prototypes[0]!.id, {
        cursor: foreignVersion.id,
        limit: 1,
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: "invalid_pagination",
    })
    const page = (await service.listVersions(
      "cross-prototype-cursor-token",
      prototypes[0]!.id,
      {},
    )) as { items: { id: string }[] }
    expect(page.items.map(({ id }) => id)).toEqual(firstPrototypeVersionIds)
  })

  it("accepts a scoped version cursor with an uppercase prototype ID", async () => {
    const { prisma, service, store } = await database()
    const actor = await createActor(store, {
      subject: "uppercase-prototype-cursor",
      token: "uppercase-prototype-cursor-token",
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: actor.user.id,
        grants: {
          create: {
            userId: actor.user.id,
            effect: "allow",
            role: "viewer",
          },
        },
      },
    })
    const prototype = await prisma.prototype.create({
      data: {
        name: "Prototype",
        workspaceId: workspace.id,
        createdByUserId: actor.user.id,
      },
    })
    const versions = await Promise.all(
      [1, 2].map((sequence) =>
        prisma.prototypeVersion.create({
          data: {
            prototypeId: prototype.id,
            createdByUserId: actor.user.id,
            sequence,
          },
        }),
      ),
    )

    await expect(
      service.listVersions("uppercase-prototype-cursor-token", prototype.id.toUpperCase(), {
        cursor: versions[0]!.id,
        limit: 1,
      }),
    ).resolves.toMatchObject({
      items: [{ id: versions[1]!.id }],
      nextCursor: null,
    })
  })

})
