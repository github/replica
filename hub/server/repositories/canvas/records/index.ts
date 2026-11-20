import type { Prisma } from "../../../generated/prisma/client.ts"

export const canvasRepositoryFields = {
  id: true,
  canvasId: true,
  githubRepositoryId: true,
  nameWithOwner: true,
  defaultBranch: true,
  localPath: true,
  removedAt: true,
} satisfies Prisma.RepositorySelect

export type CanvasRepository = Prisma.RepositoryGetPayload<{
  select: typeof canvasRepositoryFields
}>

export function canvasRepositoryId(repository: CanvasRepository) {
  const githubId = Number(repository.githubRepositoryId)
  return Number.isSafeInteger(githubId) && githubId > 0 ? githubId : repository.canvasId
}

export const canvasPairingRelations = {
  repository: { select: canvasRepositoryFields },
  session: {
    select: {
      id: true,
      membershipId: true,
      externalIdentityId: true,
      providerRevisionId: true,
      revocationRevision: true,
    },
  },
} satisfies Prisma.CanvasPairingInclude

export const canvasGrantRelations = {
  repository: { select: canvasRepositoryFields },
} satisfies Prisma.CanvasGrantInclude

export function activeCanvasGrant(now: Date): Prisma.CanvasGrantWhereInput {
  return {
    revokedAt: null,
    OR: [{ refreshDigest: null, expiresAt: { gt: now } }, { inactiveAt: { gt: now } }],
  }
}

export function activeCanvasAccess(now: Date): Prisma.CanvasGrantWhereInput {
  return { ...activeCanvasGrant(now), expiresAt: { gt: now } }
}

export function pendingCanvasPairing(now: Date): Prisma.CanvasPairingWhereInput {
  return { expiresAt: { gt: now }, approvedAt: null, consumedAt: null }
}

export async function lockCanvasRepository(database: Prisma.TransactionClient, id: string) {
  await database.$queryRaw`
    SELECT "id" FROM "repositories" WHERE "id" = ${id}::uuid FOR SHARE
  `
  return database.repository.findFirst({
    where: { id, removedAt: null },
    select: canvasRepositoryFields,
  })
}

export function lockCanvasGrant(database: Prisma.TransactionClient, id: number, mutate: boolean) {
  return mutate
    ? database.$queryRaw`SELECT "id" FROM "canvas_grants" WHERE "id" = ${id} FOR UPDATE`
    : database.$queryRaw`SELECT "id" FROM "canvas_grants" WHERE "id" = ${id} FOR SHARE`
}
