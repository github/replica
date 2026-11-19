import type { Prisma } from "../../../generated/prisma/client.ts"

export function revokeHostedCreatorLinks(
  database: Prisma.TransactionClient,
  input: { externalIdentityId: string; repositoryId: string; revokedAt: Date },
) {
  return database.shareLink.updateMany({
    where: {
      createdByExternalIdentityId: input.externalIdentityId,
      prototype: { repositoryId: input.repositoryId },
      revokedAt: null,
    },
    data: { revokedAt: input.revokedAt },
  })
}
