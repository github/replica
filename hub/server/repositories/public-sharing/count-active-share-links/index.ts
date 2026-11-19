import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function countActiveShareLinks(database: PrismaClient, now: Date, hosted = false) {
  return database.shareLink.count({
    where: {
      revokedAt: null,
      expiresAt: { gt: now },
      createdByExternalIdentityId: hosted ? { not: null } : null,
    },
  })
}
