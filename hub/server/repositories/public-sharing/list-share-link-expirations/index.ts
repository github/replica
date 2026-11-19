import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function listShareLinkExpirations(database: PrismaClient, hosted = false) {
  return database.shareLink.findMany({
    where: {
      expiresAt: { gt: new Date(0) },
      createdByExternalIdentityId: hosted ? { not: null } : null,
    },
    select: { id: true, createdAt: true, expiresAt: true },
  })
}
