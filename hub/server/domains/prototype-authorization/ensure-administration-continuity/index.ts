import { evaluatePrototypeAccess } from "#server/domains/prototype-authorization/evaluate-access"
import { AuthenticationError } from "#server/utils/authentication-error"

import type { Prisma } from "../../../generated/prisma/client.ts"

async function activeUserIds(database: Prisma.TransactionClient, userIds: string[]) {
  const memberships = await database.installationMembership.findMany({
    where: { userId: { in: userIds }, status: "active" },
    select: { userId: true },
  })
  return new Set(memberships.map(({ userId }) => userId))
}

export async function ensureProductAdministrationContinuity(
  database: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const [workspaceGrants, prototypeGrants] = await Promise.all([
    database.workspaceAccessGrant.findMany({
      where: { userId, effect: "allow", role: "administrator" },
      select: { workspaceId: true },
    }),
    database.prototypeAccessGrant.findMany({
      where: { userId, effect: "allow", role: "administrator" },
      select: { prototypeId: true, prototype: { select: { workspaceId: true } } },
    }),
  ])
  const workspaceIds = [
    ...new Set([
      ...workspaceGrants.map(({ workspaceId }) => workspaceId),
      ...prototypeGrants.map(({ prototype }) => prototype.workspaceId),
    ]),
  ].sort()
  for (const workspaceId of workspaceIds) {
    await database.$queryRaw`SELECT "id" FROM "workspaces" WHERE "id" = ${workspaceId}::uuid FOR UPDATE`
  }
  const prototypes = await database.prototype.findMany({
    where: {
      OR: [
        { workspaceId: { in: workspaceIds } },
        { id: { in: prototypeGrants.map(({ prototypeId }) => prototypeId) } },
      ],
    },
    orderBy: { id: "asc" },
    include: { grants: true, workspace: { include: { grants: true } } },
  })
  for (const { id } of prototypes) {
    await database.$queryRaw`SELECT "id" FROM "prototypes" WHERE "id" = ${id}::uuid FOR UPDATE`
  }

  const currentWorkspaceGrants = await database.workspaceAccessGrant.findMany({
    where: { workspaceId: { in: workspaceIds } },
  })
  const workspaceUsers = [
    ...new Set(currentWorkspaceGrants.map(({ userId: grantUserId }) => grantUserId)),
  ]
  const activeWorkspaceUsers = await activeUserIds(database, workspaceUsers)
  for (const workspaceId of workspaceIds) {
    const targetGrant = currentWorkspaceGrants.find(
      (grant) => grant.workspaceId === workspaceId && grant.userId === userId,
    )
    if (targetGrant?.effect !== "allow" || targetGrant.role !== "administrator") continue
    const replacement = currentWorkspaceGrants.some(
      (grant) =>
        grant.workspaceId === workspaceId &&
        grant.userId !== userId &&
        activeWorkspaceUsers.has(grant.userId) &&
        grant.effect === "allow" &&
        grant.role === "administrator",
    )
    if (!replacement) {
      throw new AuthenticationError(
        409,
        "product_administration_orphaned",
        "Transfer workspace administration before changing this membership.",
      )
    }
  }

  for (const prototype of prototypes) {
    const userIds = [
      ...new Set([
        ...prototype.workspace.grants.map(({ userId: grantUserId }) => grantUserId),
        ...prototype.grants.map(({ userId: grantUserId }) => grantUserId),
      ]),
    ]
    const activePrototypeUsers = await activeUserIds(database, userIds)
    const targetDecision = evaluatePrototypeAccess({
      workspaceGrant: prototype.workspace.grants.find((grant) => grant.userId === userId),
      prototypeGrant: prototype.grants.find((grant) => grant.userId === userId),
    })
    if (targetDecision.role !== "administrator") continue
    const replacement = userIds.some((candidateUserId) => {
      if (candidateUserId === userId || !activePrototypeUsers.has(candidateUserId)) return false
      return (
        evaluatePrototypeAccess({
          workspaceGrant: prototype.workspace.grants.find(
            (grant) => grant.userId === candidateUserId,
          ),
          prototypeGrant: prototype.grants.find((grant) => grant.userId === candidateUserId),
        }).role === "administrator"
      )
    })
    if (!replacement) {
      throw new AuthenticationError(
        409,
        "product_administration_orphaned",
        "Transfer prototype administration before changing this membership.",
      )
    }
  }
}
