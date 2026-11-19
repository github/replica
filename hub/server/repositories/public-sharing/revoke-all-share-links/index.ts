import type { Prisma } from "../../../generated/prisma/client.ts"

export function revokeAllShareLinks(
  database: Prisma.TransactionClient,
  revokedAt: Date,
  hosted = false,
) {
  return database.shareLink.updateMany({
    where: { revokedAt: null, createdByExternalIdentityId: hosted ? { not: null } : null },
    data: { revokedAt },
  })
}
