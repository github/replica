import type { Prisma } from "../../../generated/prisma/client.ts"

export function revokeAllShareLinks(database: Prisma.TransactionClient, revokedAt: Date) {
  return database.shareLink.updateMany({
    where: { revokedAt: null },
    data: { revokedAt },
  })
}
