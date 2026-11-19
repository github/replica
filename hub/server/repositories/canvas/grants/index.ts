import type { Prisma } from "../../../generated/prisma/client.ts"
import type { CanvasAuthorityReference } from "../authority/index.ts"
import { activeCanvasAccess, activeCanvasGrant, canvasGrantRelations } from "../records/index.ts"

export function issueCanvasGrant(
  database: Prisma.TransactionClient,
  data: Prisma.CanvasGrantUncheckedCreateInput,
) {
  return database.canvasGrant.create({ data })
}

function refreshableCanvasGrant(refreshDigest: string, now: Date) {
  return { refreshDigest, revokedAt: null, inactiveAt: { gt: now } }
}

export function findCanvasGrant(
  database: Prisma.TransactionClient,
  digest: string,
  refresh = false,
) {
  const now = new Date()
  return database.canvasGrant.findFirst({
    where: refresh
      ? refreshableCanvasGrant(digest, now)
      : { tokenDigest: digest, ...activeCanvasAccess(now) },
    include: canvasGrantRelations,
  })
}

export async function verifyCanvasAccess(
  database: Prisma.TransactionClient,
  id: number,
  tokenDigest: string,
  now: Date,
  inactiveAt?: Date,
) {
  const where = { id, tokenDigest, ...activeCanvasAccess(now) }
  if (!inactiveAt)
    return Boolean(await database.canvasGrant.findFirst({ where, select: { id: true } }))
  const result = await database.canvasGrant.updateMany({
    where,
    data: { lastActiveAt: now, inactiveAt },
  })
  return result.count === 1
}

export async function rotateCanvasAccess(
  database: Prisma.TransactionClient,
  id: number,
  refreshDigest: string,
  tokenDigest: string,
  accessLifetime: number,
) {
  const now = new Date()
  const where = { id, ...refreshableCanvasGrant(refreshDigest, now) }
  const active = await database.canvasGrant.findFirst({ where, select: { inactiveAt: true } })
  if (!active?.inactiveAt) return null
  const expiresAt = new Date(Math.min(now.getTime() + accessLifetime, active.inactiveAt.getTime()))
  const [updated] = await database.canvasGrant.updateManyAndReturn({
    where,
    data: { tokenDigest, expiresAt },
    select: { id: true, expiresAt: true, inactiveAt: true },
  })
  return updated ?? null
}

export async function revokeCanvasGrant(
  database: Prisma.TransactionClient,
  credential:
    { digest: string; refresh: boolean } | { id: number; owner: CanvasAuthorityReference },
) {
  const now = new Date()
  const where =
    "owner" in credential
      ? { id: credential.id, ...activeCanvasGrant(now), ...credential.owner }
      : credential.refresh
        ? refreshableCanvasGrant(credential.digest, now)
        : { tokenDigest: credential.digest, ...activeCanvasAccess(now) }
  const [revoked] = await database.canvasGrant.updateManyAndReturn({
    where,
    data: { revokedAt: now },
    select: { id: true, repositoryId: true, membershipId: true },
  })
  return revoked ?? null
}

export function listCanvasGrants(
  database: Prisma.TransactionClient,
  owner: CanvasAuthorityReference,
) {
  return database.canvasGrant.findMany({
    where: { ...activeCanvasGrant(new Date()), ...owner },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      expiresAt: true,
      inactiveAt: true,
      repository: { select: { nameWithOwner: true } },
    },
  })
}
