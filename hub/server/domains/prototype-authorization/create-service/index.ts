import { z } from "zod"

import { createIdentityRecords } from "#server/domains/identity/create-records"
import type { IdentityStore } from "#server/domains/identity/create-store/types"
import {
  type AccessDecision,
  type PrototypeRole,
} from "#server/domains/prototype-authorization/evaluate-access/types"
import { evaluatePrototypeAccess } from "#server/domains/prototype-authorization/evaluate-access"
import type {
  GrantInput,
  PrototypeBaselinePolicy,
  PrototypeAuthorizationService,
} from "#server/domains/prototype-authorization/create-service/types"
import { getCurrentSession } from "#server/domains/authentication/get-current-session"
import { saveSecurityAudit } from "#server/repositories/security-audits/save-audit"
import { AuthenticationError } from "#server/utils/authentication-error"

import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"

const nameSchema = z.object({ name: z.string().trim().min(1).max(120) })
const versionSchema = z.object({ label: z.string().trim().min(1).max(120).nullable().optional() })
const pageSchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
const grantSchema = z.discriminatedUnion("effect", [
  z.object({ effect: z.literal("deny") }),
  z.object({
    effect: z.literal("allow"),
    role: z.enum(["viewer", "commenter", "editor", "administrator"]),
  }),
])
const roles: PrototypeRole[] = ["viewer", "commenter", "editor", "administrator"]
const identifierSchema = z.uuid()
const authorizationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("hub-managed") }),
  z.object({ mode: z.literal("github-synchronized"), repositorySourceId: z.uuid() }),
])

function authenticationDependencies(store: IdentityStore) {
  return {
    store,
    github: null,
    configuration: null,
    providerRevisionId: null,
    admissionPolicy: { name: "hub-managed" as const, admit: () => Promise.resolve(null) },
    now: () => new Date(),
  }
}

function parsePage(query: unknown) {
  const parsed = pageSchema.safeParse(query)
  if (!parsed.success) {
    throw new AuthenticationError(422, "invalid_pagination", "Pagination is invalid.")
  }
  return parsed.data
}

async function requirePrototypeCursor(
  database: PrismaClient,
  workspaceId: string,
  cursor?: string,
): Promise<void> {
  if (!cursor) return
  const prototype = await database.prototype.findUnique({
    where: { id: cursor },
    select: { workspaceId: true },
  })
  if (prototype?.workspaceId !== workspaceId) {
    throw new AuthenticationError(422, "invalid_pagination", "Pagination is invalid.")
  }
}

async function requireVersionCursor(
  database: PrismaClient,
  prototypeId: string,
  cursor?: string,
): Promise<void> {
  if (!cursor) return
  const version = await database.prototypeVersion.findUnique({
    where: { id: cursor },
    select: { prototypeId: true },
  })
  if (version?.prototypeId !== prototypeId) {
    throw new AuthenticationError(422, "invalid_pagination", "Pagination is invalid.")
  }
}

function parseName(input: unknown, code: string, message: string) {
  const parsed = nameSchema.safeParse(input)
  if (!parsed.success) throw new AuthenticationError(422, code, message)
  return parsed.data
}

function parseGrant(input: unknown): GrantInput {
  const parsed = grantSchema.safeParse(input)
  if (!parsed.success) {
    throw new AuthenticationError(422, "invalid_access_change", "The access change is invalid.")
  }
  return parsed.data.effect === "deny"
    ? { effect: "deny", role: null }
    : { effect: "allow", role: parsed.data.role }
}

function hasRole(actual: PrototypeRole | null, required: PrototypeRole): boolean {
  return actual !== null && roles.indexOf(actual) >= roles.indexOf(required)
}

function requireIdentifier(value: string, code: string, message: string): void {
  if (!identifierSchema.safeParse(value).success) {
    throw new AuthenticationError(404, code, message)
  }
}

function normalizeIdentifier(value: string, code: string, message: string): string {
  requireIdentifier(value, code, message)
  return value.toLowerCase()
}

function requireDecision(decision: AccessDecision, required: PrototypeRole): void {
  if (!decision.allowed || !hasRole(decision.role, required)) {
    throw new AuthenticationError(403, "prototype_access_denied", "Prototype access is denied.")
  }
}

function requireFreshAuthorization(actor: Awaited<ReturnType<typeof currentSession>>): void {
  if (!actor.freshAuthorizedAt || Date.now() - actor.freshAuthorizedAt.getTime() >= 5 * 60_000) {
    throw new AuthenticationError(
      403,
      "fresh_authorization_required",
      "Verify your identity again.",
    )
  }
}

async function currentSession(
  store: IdentityStore,
  sessionToken: string,
  database?: Prisma.TransactionClient,
) {
  return getCurrentSession(
    authenticationDependencies(store),
    sessionToken,
    database ? createIdentityRecords(database) : store.read,
  )
}

async function requireActiveTarget(database: Prisma.TransactionClient, userId: string) {
  if (!identifierSchema.safeParse(userId).success) {
    throw new AuthenticationError(422, "target_user_inactive", "The target user is not active.")
  }
  const membership = await database.installationMembership.findUnique({ where: { userId } })
  if (!membership || membership.status !== "active") {
    throw new AuthenticationError(422, "target_user_inactive", "The target user is not active.")
  }
}

async function preserveManualAdministration(
  database: Prisma.TransactionClient,
  userId: string,
  change: GrantInput,
): Promise<void> {
  if (change.effect !== "allow" || change.role !== "administrator") return
  await database.installationMembership.updateMany({
    where: { userId, source: "synchronized", status: "active" },
    data: { source: "manual" },
  })
}

async function lockWorkspace(
  database: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  await database.$queryRaw`SELECT "id" FROM "workspaces" WHERE "id" = ${workspaceId}::uuid FOR UPDATE`
}

async function lockPrototype(
  database: Prisma.TransactionClient,
  prototypeId: string,
): Promise<void> {
  await database.$queryRaw`SELECT "id" FROM "prototypes" WHERE "id" = ${prototypeId}::uuid FOR UPDATE`
}

async function lockGitHubRepositorySource(
  database: Prisma.TransactionClient,
  repositorySourceId: string,
): Promise<void> {
  await database.$queryRaw`
    SELECT "id"
    FROM "github_repository_sources"
    WHERE "id" = ${repositorySourceId}::uuid
    FOR UPDATE
  `
}

async function lockWorkspacePrototypes(
  database: Prisma.TransactionClient,
  workspaceId: string,
): Promise<string[]> {
  const prototypes = await database.prototype.findMany({
    where: { workspaceId },
    orderBy: { id: "asc" },
    select: { id: true },
  })
  for (const { id } of prototypes) await lockPrototype(database, id)
  return prototypes.map(({ id }) => id)
}

async function workspaceDecision(
  database: Prisma.TransactionClient,
  userId: string,
  workspaceId: string,
) {
  requireIdentifier(workspaceId, "workspace_not_found", "The workspace was not found.")
  const workspace = await database.workspace.findUnique({
    where: { id: workspaceId },
    include: { grants: { where: { userId } } },
  })
  if (!workspace) {
    throw new AuthenticationError(404, "workspace_not_found", "The workspace was not found.")
  }
  return {
    workspace,
    decision: evaluatePrototypeAccess({ workspaceGrant: workspace.grants[0] ?? null }),
  }
}

async function prototypeDecision(
  baseline: PrototypeBaselinePolicy | null,
  database: Prisma.TransactionClient,
  userId: string,
  prototypeId: string,
) {
  requireIdentifier(prototypeId, "prototype_not_found", "The prototype was not found.")
  const prototype = await database.prototype.findUnique({
    where: { id: prototypeId },
    include: {
      grants: { where: { userId } },
      workspace: { include: { grants: { where: { userId } } } },
    },
  })
  if (!prototype) {
    throw new AuthenticationError(404, "prototype_not_found", "The prototype was not found.")
  }
  const decision = await prototypeAccessDecision(
    baseline,
    database,
    userId,
    prototype.workspace.grants[0] ?? null,
    prototype,
  )
  return {
    prototype,
    decision,
  }
}

async function hasPrototypeAdministratorAfter(
  database: Prisma.TransactionClient,
  prototypeId: string,
  targetUserId: string,
  replacement: GrantInput | null,
  scope: "prototype" | "workspace" = "prototype",
  excludedUserId?: string,
): Promise<boolean> {
  const prototype = await database.prototype.findUnique({
    where: { id: prototypeId },
    include: { grants: true, workspace: { include: { grants: true } } },
  })
  if (!prototype) return false
  const userIds = new Set([
    ...prototype.workspace.grants.map(({ userId }) => userId),
    ...prototype.grants.map(({ userId }) => userId),
    targetUserId,
  ])
  const activeMemberships = await database.installationMembership.findMany({
    where: {
      userId: { in: [...userIds], ...(excludedUserId ? { not: excludedUserId } : {}) },
      status: "active",
    },
    select: { userId: true },
  })
  const activeUserIds = new Set(activeMemberships.map(({ userId }) => userId))
  return [...userIds].some((userId) => {
    if (!activeUserIds.has(userId)) return false
    const workspaceGrant =
      scope === "workspace" && userId === targetUserId
        ? replacement
        : prototype.workspace.grants.find((grant) => grant.userId === userId)
    const prototypeGrant =
      scope === "prototype" && userId === targetUserId
        ? replacement
        : prototype.grants.find((grant) => grant.userId === userId)
    return evaluatePrototypeAccess({ workspaceGrant, prototypeGrant }).role === "administrator"
  })
}

async function hasWorkspaceAdministratorAfter(
  database: Prisma.TransactionClient,
  workspaceId: string,
  targetUserId: string,
  replacement: GrantInput | null,
  excludedUserId?: string,
): Promise<boolean> {
  const grants = await database.workspaceAccessGrant.findMany({ where: { workspaceId } })
  const userIds = new Set([...grants.map(({ userId }) => userId), targetUserId])
  const activeMemberships = await database.installationMembership.findMany({
    where: {
      userId: { in: [...userIds], ...(excludedUserId ? { not: excludedUserId } : {}) },
      status: "active",
    },
    select: { userId: true },
  })
  const activeUserIds = new Set(activeMemberships.map(({ userId }) => userId))
  return [...userIds].some((userId) => {
    if (!activeUserIds.has(userId)) return false
    const grant =
      userId === targetUserId
        ? replacement
        : grants.find((candidate) => candidate.userId === userId)
    return grant?.effect === "allow" && grant.role === "administrator"
  })
}

function pageResult<T extends { id: string }>(items: T[], limit: number) {
  const hasMore = items.length > limit
  const pageItems = hasMore ? items.slice(0, limit) : items
  return {
    items: pageItems,
    nextCursor: hasMore ? (pageItems.at(-1)?.id ?? null) : null,
  }
}

function prototypeDto(prototype: {
  id: string
  workspaceId: string
  createdByUserId: string
  name: string
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: prototype.id,
    workspaceId: prototype.workspaceId,
    createdByUserId: prototype.createdByUserId,
    name: prototype.name,
    archivedAt: prototype.archivedAt,
    createdAt: prototype.createdAt,
    updatedAt: prototype.updatedAt,
  }
}

async function prototypeAccessDecision(
  baseline: PrototypeBaselinePolicy | null,
  database: Prisma.TransactionClient | PrismaClient,
  userId: string,
  workspaceGrant: GrantInput | null,
  prototype: {
    id: string
    grants: GrantInput[]
  },
) {
  const hubDecision = evaluatePrototypeAccess({
    workspaceGrant,
    prototypeGrant: prototype.grants[0] ?? null,
  })
  if (hubDecision.source !== "none" || !baseline) return hubDecision
  return evaluatePrototypeAccess({
    baseline: await baseline.baseline(database, userId, prototype.id),
  })
}

async function readAccessibleWorkspacePage({
  baseline,
  database,
  userId,
  cursor,
  limit,
}: {
  baseline: PrototypeBaselinePolicy | null
  database: PrismaClient
  userId: string
  cursor?: string
  limit: number
}) {
  const baselineWorkspaceIds = baseline?.workspaceIds
    ? await baseline.workspaceIds(database, userId)
    : []
  const items = []
  let scanCursor = cursor
  while (items.length <= limit) {
    const candidates = await database.workspace.findMany({
      where: {
        OR: [
          { grants: { some: { userId } } },
          { prototypes: { some: { grants: { some: { userId } } } } },
          ...(baselineWorkspaceIds.length > 0 ? [{ id: { in: baselineWorkspaceIds } }] : []),
        ],
      },
      include: { grants: { where: { userId } } },
      orderBy: { id: "asc" },
      ...(scanCursor ? { cursor: { id: scanCursor }, skip: 1 } : {}),
      take: 100,
    })
    if (candidates.length === 0) break
    for (const candidate of candidates) {
      scanCursor = candidate.id
      const workspaceGrant = candidate.grants[0] ?? null
      if (
        evaluatePrototypeAccess({ workspaceGrant }).allowed ||
        (await hasAnyPrototypeAccess({
          baseline,
          database,
          userId,
          workspaceId: candidate.id,
          workspaceGrant,
        }))
      ) {
        items.push({
          id: candidate.id,
          createdByUserId: candidate.createdByUserId,
          name: candidate.name,
          createdAt: candidate.createdAt,
          updatedAt: candidate.updatedAt,
        })
      }
      if (items.length > limit) break
    }
    if (candidates.length < 100) break
  }
  return pageResult(items, limit)
}

async function readAccessiblePrototypePage({
  baseline,
  database,
  userId,
  workspaceId,
  workspaceGrant,
  cursor,
  limit,
}: {
  baseline: PrototypeBaselinePolicy | null
  database: PrismaClient
  userId: string
  workspaceId: string
  workspaceGrant: GrantInput | null
  cursor?: string
  limit: number
}) {
  if (!baseline) {
    const accessWhere = workspaceGrant
      ? { grants: { none: { userId, effect: "deny" as const } } }
      : { grants: { some: { userId, effect: "allow" as const } } }
    const items = await database.prototype.findMany({
      where: {
        workspaceId,
        ...(cursor ? { id: { gt: cursor } } : {}),
        ...accessWhere,
      },
      orderBy: { id: "asc" },
      take: limit + 1,
    })
    return pageResult(items.map(prototypeDto), limit)
  }
  const items = []
  let scanCursor = cursor
  while (items.length <= limit) {
    const candidates = await database.prototype.findMany({
      where: { workspaceId, ...(scanCursor ? { id: { gt: scanCursor } } : {}) },
      include: { grants: { where: { userId } } },
      orderBy: { id: "asc" },
      take: 100,
    })
    if (candidates.length === 0) break
    for (const candidate of candidates) {
      scanCursor = candidate.id
      const decision = await prototypeAccessDecision(
        baseline,
        database,
        userId,
        workspaceGrant,
        candidate,
      )
      if (decision.allowed) items.push(prototypeDto(candidate))
      if (items.length > limit) break
    }
    if (candidates.length < 100) break
  }
  return pageResult(items, limit)
}

async function hasAnyPrototypeAccess({
  baseline,
  database,
  userId,
  workspaceId,
  workspaceGrant,
}: {
  baseline: PrototypeBaselinePolicy | null
  database: PrismaClient
  userId: string
  workspaceId: string
  workspaceGrant: GrantInput | null
}) {
  const workspaceDecision = evaluatePrototypeAccess({ workspaceGrant })
  if (workspaceDecision.source !== "none") return workspaceDecision.allowed
  if (!baseline) {
    return Boolean(
      await database.prototype.findFirst({
        where: {
          workspaceId,
          grants: { some: { userId, effect: "allow" } },
        },
        select: { id: true },
      }),
    )
  }
  let cursor: string | undefined
  while (true) {
    const candidates = await database.prototype.findMany({
      where: { workspaceId, ...(cursor ? { id: { gt: cursor } } : {}) },
      include: { grants: { where: { userId } } },
      orderBy: { id: "asc" },
      take: 100,
    })
    for (const candidate of candidates) {
      if (
        (await prototypeAccessDecision(baseline, database, userId, workspaceGrant, candidate))
          .allowed
      ) {
        return true
      }
    }
    if (candidates.length < 100) return false
    cursor = candidates.at(-1)?.id
  }
}

async function audit(
  database: Prisma.TransactionClient,
  actor: Awaited<ReturnType<typeof currentSession>>,
  input: Omit<
    Parameters<typeof saveSecurityAudit>[1],
    "actorUserId" | "sessionId" | "authenticationProviderRevisionId"
  >,
) {
  await saveSecurityAudit(database, {
    ...input,
    actorUserId: actor.userId,
    sessionId: actor.id,
    authenticationProviderRevisionId: actor.authenticationProviderRevisionId,
  })
}

export function createPrototypeAuthorizationService({
  baseline = null,
  database,
  store,
}: {
  baseline?: PrototypeBaselinePolicy | null
  database: PrismaClient
  store: IdentityStore
}): PrototypeAuthorizationService {
  return {
    async listWorkspaces(sessionToken, query) {
      const { cursor, limit } = parsePage(query)
      const actor = await currentSession(store, sessionToken)
      return readAccessibleWorkspacePage({
        baseline,
        database,
        userId: actor.userId,
        cursor,
        limit,
      })
    },

    async createWorkspace(sessionToken, input) {
      const { name } = parseName(input, "invalid_workspace", "The workspace is invalid.")
      return store.lock(async (_records, transaction) => {
        const actor = await currentSession(store, sessionToken, transaction)
        requireFreshAuthorization(actor)
        if (actor.membership.role !== "administrator") {
          throw new AuthenticationError(
            403,
            "installation_administrator_required",
            "Installation administrator access is required.",
          )
        }
        const workspace = await transaction.workspace.create({
          data: {
            name,
            createdByUserId: actor.userId,
            grants: {
              create: {
                userId: actor.userId,
                effect: "allow",
                role: "administrator",
              },
            },
          },
        })
        await audit(transaction, actor, {
          event: "workspace.create",
          workspaceId: workspace.id,
          context: { source: "installation_administrator" },
        })
        return workspace
      })
    },

    async getWorkspace(sessionToken, workspaceId) {
      const actor = await currentSession(store, sessionToken)
      const { workspace, decision } = await workspaceDecision(database, actor.userId, workspaceId)
      requireDecision(decision, "viewer")
      return {
        id: workspace.id,
        createdByUserId: workspace.createdByUserId,
        name: workspace.name,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      }
    },

    async setWorkspaceAccess(sessionToken, workspaceId, targetUserId, input) {
      const change = parseGrant(input)
      const targetId = normalizeIdentifier(
        targetUserId,
        "target_user_inactive",
        "The target user is not active.",
      )
      return store.lock(async (_records, transaction) => {
        const actor = await currentSession(store, sessionToken, transaction)
        requireFreshAuthorization(actor)
        requireIdentifier(workspaceId, "workspace_not_found", "The workspace was not found.")
        await lockWorkspace(transaction, workspaceId)
        const { decision } = await workspaceDecision(transaction, actor.userId, workspaceId)
        requireDecision(decision, "administrator")
        await requireActiveTarget(transaction, targetId)
        const prototypeIds = await lockWorkspacePrototypes(transaction, workspaceId)
        if (!(await hasWorkspaceAdministratorAfter(transaction, workspaceId, targetId, change))) {
          throw new AuthenticationError(
            409,
            "last_workspace_administrator",
            "The final workspace administrator cannot be changed.",
          )
        }
        for (const prototypeId of prototypeIds) {
          if (
            !(await hasPrototypeAdministratorAfter(
              transaction,
              prototypeId,
              targetId,
              change,
              "workspace",
            ))
          ) {
            throw new AuthenticationError(
              409,
              "last_prototype_administrator",
              "The access change would leave a prototype without an administrator.",
            )
          }
        }
        const grant = await transaction.workspaceAccessGrant.upsert({
          where: { workspaceId_userId: { workspaceId, userId: targetId } },
          create: { workspaceId, userId: targetId, ...change },
          update: change,
        })
        await preserveManualAdministration(transaction, targetUserId, change)
        await audit(transaction, actor, {
          event: change.effect === "deny" ? "workspace.access.deny" : "workspace.access.grant",
          workspaceId,
          targetUserId: targetId,
          context: { reason: change.effect === "deny" ? "explicit_deny" : `role_${change.role}` },
        })
        return grant
      })
    },

    async removeWorkspaceAccess(sessionToken, workspaceId, targetUserId) {
      const targetId = normalizeIdentifier(
        targetUserId,
        "access_not_found",
        "The access rule was not found.",
      )
      await store.lock(async (_records, transaction) => {
        const actor = await currentSession(store, sessionToken, transaction)
        requireFreshAuthorization(actor)
        requireIdentifier(workspaceId, "workspace_not_found", "The workspace was not found.")
        await lockWorkspace(transaction, workspaceId)
        const { decision } = await workspaceDecision(transaction, actor.userId, workspaceId)
        requireDecision(decision, "administrator")
        const prototypeIds = await lockWorkspacePrototypes(transaction, workspaceId)
        const existing = await transaction.workspaceAccessGrant.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: targetId } },
        })
        if (!existing) {
          throw new AuthenticationError(404, "access_not_found", "The access rule was not found.")
        }
        if (!(await hasWorkspaceAdministratorAfter(transaction, workspaceId, targetId, null))) {
          throw new AuthenticationError(
            409,
            "last_workspace_administrator",
            "The final workspace administrator cannot be removed.",
          )
        }
        for (const prototypeId of prototypeIds) {
          if (
            !(await hasPrototypeAdministratorAfter(
              transaction,
              prototypeId,
              targetId,
              null,
              "workspace",
            ))
          ) {
            throw new AuthenticationError(
              409,
              "last_prototype_administrator",
              "Removing access would leave a prototype without an administrator.",
            )
          }
        }
        await transaction.workspaceAccessGrant.delete({
          where: { workspaceId_userId: { workspaceId, userId: targetId } },
        })
        await audit(transaction, actor, {
          event: "workspace.access.remove",
          workspaceId,
          targetUserId: targetId,
        })
      })
    },

    async listPrototypes(sessionToken, workspaceId, query) {
      const { cursor, limit } = parsePage(query)
      const actor = await currentSession(store, sessionToken)
      const { workspace } = await workspaceDecision(database, actor.userId, workspaceId)
      await requirePrototypeCursor(database, workspaceId, cursor)
      const workspaceGrant = workspace.grants[0] ?? null
      if (
        !(await hasAnyPrototypeAccess({
          baseline,
          database,
          userId: actor.userId,
          workspaceId,
          workspaceGrant,
        }))
      ) {
        throw new AuthenticationError(403, "prototype_access_denied", "Prototype access is denied.")
      }
      return readAccessiblePrototypePage({
        baseline,
        database,
        userId: actor.userId,
        workspaceId,
        workspaceGrant,
        cursor,
        limit,
      })
    },

    async createPrototype(sessionToken, workspaceId, input) {
      const { name } = parseName(input, "invalid_prototype", "The prototype is invalid.")
      return store.lock(async (_records, transaction) => {
        const actor = await currentSession(store, sessionToken, transaction)
        const { decision } = await workspaceDecision(transaction, actor.userId, workspaceId)
        requireDecision(decision, "editor")
        const prototype = await transaction.prototype.create({
          data: { workspaceId, name, createdByUserId: actor.userId },
        })
        await audit(transaction, actor, {
          event: "prototype.create",
          workspaceId,
          prototypeId: prototype.id,
        })
        return prototype
      })
    },

    async getPrototype(sessionToken, prototypeId) {
      const actor = await currentSession(store, sessionToken)
      const { prototype, decision } = await prototypeDecision(
        baseline,
        database,
        actor.userId,
        prototypeId,
      )
      requireDecision(decision, "viewer")
      return {
        id: prototype.id,
        workspaceId: prototype.workspaceId,
        createdByUserId: prototype.createdByUserId,
        name: prototype.name,
        archivedAt: prototype.archivedAt,
        createdAt: prototype.createdAt,
        updatedAt: prototype.updatedAt,
      }
    },

    async archivePrototype(sessionToken, prototypeId) {
      return store.lock(async (_records, transaction) => {
        const actor = await currentSession(store, sessionToken, transaction)
        requireIdentifier(prototypeId, "prototype_not_found", "The prototype was not found.")
        await lockPrototype(transaction, prototypeId)
        const { prototype, decision } = await prototypeDecision(
          baseline,
          transaction,
          actor.userId,
          prototypeId,
        )
        requireDecision(decision, "editor")
        if (prototype.archivedAt) {
          throw new AuthenticationError(
            409,
            "prototype_archived",
            "The prototype is already archived.",
          )
        }
        const archived = await transaction.prototype.update({
          where: { id: prototypeId },
          data: { archivedAt: new Date() },
        })
        await audit(transaction, actor, {
          event: "prototype.archive",
          workspaceId: prototype.workspaceId,
          prototypeId,
        })
        return archived
      })
    },

    async explainPrototypeAccess(sessionToken, prototypeId) {
      const actor = await currentSession(store, sessionToken)
      const { decision } = await prototypeDecision(baseline, database, actor.userId, prototypeId)
      return decision
    },

    async setPrototypeAuthorization(sessionToken, prototypeId, input) {
      const parsed = authorizationSchema.safeParse(input)
      if (!parsed.success) {
        throw new AuthenticationError(
          422,
          "invalid_authorization_policy",
          "The prototype authorization policy is invalid.",
        )
      }
      return store.lock(async (_records, transaction) => {
        const actor = await currentSession(store, sessionToken, transaction)
        requireFreshAuthorization(actor)
        requireIdentifier(prototypeId, "prototype_not_found", "The prototype was not found.")
        await lockPrototype(transaction, prototypeId)
        const { prototype, decision } = await prototypeDecision(
          baseline,
          transaction,
          actor.userId,
          prototypeId,
        )
        requireDecision(decision, "administrator")
        if (parsed.data.mode === "github-synchronized") {
          await lockGitHubRepositorySource(transaction, parsed.data.repositorySourceId)
          const source = await transaction.gitHubRepositorySource.findUnique({
            where: { id: parsed.data.repositorySourceId },
          })
          if (!source || source.status !== "active") {
            throw new AuthenticationError(
              422,
              "repository_source_unavailable",
              "The linked GitHub repository is unavailable.",
            )
          }
        }
        const updated = await transaction.prototype.update({
          where: { id: prototypeId },
          data:
            parsed.data.mode === "hub-managed"
              ? { authorizationMode: "hub-managed", sourceRepositoryId: null }
              : {
                  authorizationMode: "github-synchronized",
                  sourceRepositoryId: parsed.data.repositorySourceId,
                },
        })
        await audit(transaction, actor, {
          event: "prototype.authorization.policy",
          workspaceId: prototype.workspaceId,
          prototypeId,
          githubRepositorySourceId:
            parsed.data.mode === "github-synchronized" ? parsed.data.repositorySourceId : null,
          context: {
            reason: parsed.data.mode === "hub-managed" ? "hub_managed" : "github_synchronized",
          },
        })
        return updated
      })
    },

    async setPrototypeAccess(sessionToken, prototypeId, targetUserId, input) {
      const change = parseGrant(input)
      const targetId = normalizeIdentifier(
        targetUserId,
        "target_user_inactive",
        "The target user is not active.",
      )
      return store.lock(async (_records, transaction) => {
        const actor = await currentSession(store, sessionToken, transaction)
        requireFreshAuthorization(actor)
        requireIdentifier(prototypeId, "prototype_not_found", "The prototype was not found.")
        await lockPrototype(transaction, prototypeId)
        const { prototype, decision } = await prototypeDecision(
          baseline,
          transaction,
          actor.userId,
          prototypeId,
        )
        requireDecision(decision, "administrator")
        await requireActiveTarget(transaction, targetId)
        if (!(await hasPrototypeAdministratorAfter(transaction, prototypeId, targetId, change))) {
          throw new AuthenticationError(
            409,
            "last_prototype_administrator",
            "The final prototype administrator cannot be changed.",
          )
        }
        const grant = await transaction.prototypeAccessGrant.upsert({
          where: { prototypeId_userId: { prototypeId, userId: targetId } },
          create: { prototypeId, userId: targetId, ...change },
          update: change,
        })
        await preserveManualAdministration(transaction, targetId, change)
        await audit(transaction, actor, {
          event: change.effect === "deny" ? "prototype.access.deny" : "prototype.access.grant",
          workspaceId: prototype.workspaceId,
          prototypeId,
          targetUserId: targetId,
          context: { reason: change.effect === "deny" ? "explicit_deny" : `role_${change.role}` },
        })
        return grant
      })
    },

    async removePrototypeAccess(sessionToken, prototypeId, targetUserId) {
      const targetId = normalizeIdentifier(
        targetUserId,
        "access_not_found",
        "The access rule was not found.",
      )
      await store.lock(async (_records, transaction) => {
        const actor = await currentSession(store, sessionToken, transaction)
        requireFreshAuthorization(actor)
        requireIdentifier(prototypeId, "prototype_not_found", "The prototype was not found.")
        await lockPrototype(transaction, prototypeId)
        const { prototype, decision } = await prototypeDecision(
          baseline,
          transaction,
          actor.userId,
          prototypeId,
        )
        requireDecision(decision, "administrator")
        if (!(await hasPrototypeAdministratorAfter(transaction, prototypeId, targetId, null))) {
          throw new AuthenticationError(
            409,
            "last_prototype_administrator",
            "The final prototype administrator cannot be removed.",
          )
        }
        const removed = await transaction.prototypeAccessGrant.deleteMany({
          where: { prototypeId, userId: targetId },
        })
        if (removed.count === 0) {
          throw new AuthenticationError(404, "access_not_found", "The access rule was not found.")
        }
        await audit(transaction, actor, {
          event: "prototype.access.remove",
          workspaceId: prototype.workspaceId,
          prototypeId,
          targetUserId: targetId,
        })
      })
    },

    async listVersions(sessionToken, prototypeId, query) {
      const { cursor, limit } = parsePage(query)
      const actor = await currentSession(store, sessionToken)
      const { decision } = await prototypeDecision(baseline, database, actor.userId, prototypeId)
      requireDecision(decision, "viewer")
      await requireVersionCursor(database, prototypeId, cursor)
      const items = await database.prototypeVersion.findMany({
        where: { prototypeId },
        orderBy: { sequence: "asc" },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: limit + 1,
      })
      return pageResult(items, limit)
    },

    async createVersion(sessionToken, prototypeId, input) {
      const parsed = versionSchema.safeParse(input)
      if (!parsed.success) {
        throw new AuthenticationError(422, "invalid_version", "The version is invalid.")
      }
      return store.lock(async (_records, transaction) => {
        const actor = await currentSession(store, sessionToken, transaction)
        requireIdentifier(prototypeId, "prototype_not_found", "The prototype was not found.")
        await lockPrototype(transaction, prototypeId)
        const { prototype, decision } = await prototypeDecision(
          baseline,
          transaction,
          actor.userId,
          prototypeId,
        )
        requireDecision(decision, "editor")
        if (prototype.archivedAt) {
          throw new AuthenticationError(
            409,
            "prototype_archived",
            "Archived prototypes cannot receive versions.",
          )
        }
        const latest = await transaction.prototypeVersion.findFirst({
          where: { prototypeId },
          orderBy: { sequence: "desc" },
        })
        const version = await transaction.prototypeVersion.create({
          data: {
            prototypeId,
            createdByUserId: actor.userId,
            sequence: (latest?.sequence ?? 0) + 1,
            label: parsed.data.label ?? null,
          },
        })
        await audit(transaction, actor, {
          event: "prototype.version.create",
          workspaceId: prototype.workspaceId,
          prototypeId,
          prototypeVersionId: version.id,
        })
        return version
      })
    },

    async getVersion(sessionToken, prototypeId, versionId) {
      const actor = await currentSession(store, sessionToken)
      const { decision } = await prototypeDecision(baseline, database, actor.userId, prototypeId)
      requireDecision(decision, "viewer")
      requireIdentifier(versionId, "version_not_found", "The version was not found.")
      const version = await database.prototypeVersion.findFirst({
        where: { id: versionId, prototypeId },
      })
      if (!version) {
        throw new AuthenticationError(404, "version_not_found", "The version was not found.")
      }
      return version
    },
  }
}
