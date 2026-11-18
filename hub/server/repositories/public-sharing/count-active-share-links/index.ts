import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function countActiveShareLinks(database: PrismaClient, now: Date) {
  return database.shareLink.count({
    where: { revokedAt: null, expiresAt: { gt: now } },
  })
}
