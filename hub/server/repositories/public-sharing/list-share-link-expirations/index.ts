import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function listShareLinkExpirations(database: PrismaClient) {
  return database.shareLink.findMany({
    where: { expiresAt: { gt: new Date(0) } },
    select: { id: true, createdAt: true, expiresAt: true },
  })
}
