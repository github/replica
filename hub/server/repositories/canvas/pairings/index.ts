import type { Prisma } from "../../../generated/prisma/client.ts"
import {
  canvasPairingRelations,
  canvasRepositoryFields,
  pendingCanvasPairing,
} from "../records/index.ts"

export async function findCanvasPairingRepository(
  database: Prisma.TransactionClient,
  name: string,
) {
  const matches = await database.repository.findMany({
    where: {
      removedAt: null,
      nameWithOwner: { equals: name, mode: "insensitive" },
      OR: [
        { githubRepositoryId: { not: null }, localPath: null },
        { githubRepositoryId: null, localPath: { not: null } },
      ],
    },
    select: { id: true },
    take: 2,
  })
  return matches.length === 1 ? matches[0]! : null
}

export function createCanvasPairing(
  database: Prisma.TransactionClient,
  data: Prisma.CanvasPairingUncheckedCreateInput,
) {
  return database.canvasPairing.create({ data })
}

export function findPendingCanvasPairing(database: Prisma.TransactionClient, userCode: string) {
  return database.canvasPairing.findFirst({
    where: { userCode, ...pendingCanvasPairing(new Date()) },
    include: { repository: { select: canvasRepositoryFields } },
  })
}

export function findCanvasPairingByDevice(
  database: Prisma.TransactionClient,
  deviceDigest: string,
) {
  return database.canvasPairing.findUnique({
    where: { deviceDigest },
    include: canvasPairingRelations,
  })
}

export async function confirmPendingCanvasPairing(
  database: Prisma.TransactionClient,
  id: string,
  approvingSessionId: string | null,
) {
  const now = new Date()
  const where = { id, ...pendingCanvasPairing(now) }
  if (!approvingSessionId) {
    return Boolean(await database.canvasPairing.findFirst({ where, select: { id: true } }))
  }
  const updated = await database.canvasPairing.updateMany({
    where,
    data: { sessionId: approvingSessionId, approvedAt: now },
  })
  return updated.count === 1
}

export async function claimCanvasPairing(
  database: Prisma.TransactionClient,
  id: string,
  sessionId: string,
  now: Date,
) {
  const updated = await database.canvasPairing.updateMany({
    where: { id, sessionId, expiresAt: { gt: now }, consumedAt: null },
    data: { consumedAt: now },
  })
  return updated.count === 1
}

export function pruneExpiredCanvasPairings(database: Prisma.TransactionClient) {
  return database.$executeRaw`
    DELETE FROM "canvas_pairings" WHERE "id" IN (
      SELECT "id" FROM "canvas_pairings"
      WHERE "expires_at" <= clock_timestamp()
      ORDER BY "expires_at" LIMIT 100 FOR UPDATE SKIP LOCKED
    )
  `
}
