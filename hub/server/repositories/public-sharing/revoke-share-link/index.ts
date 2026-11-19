import type { Prisma } from "../../../generated/prisma/client.ts"

export async function revokeShareLink(
  database: Prisma.TransactionClient,
  input: {
    repositoryId: string
    prototypeId: string
    publicId: string
    revokedAt: Date
  },
  hosted = false,
) {
  const result = await database.shareLink.updateMany({
    where: {
      prototypeId: input.prototypeId,
      publicId: input.publicId,
      revokedAt: null,
      ...(hosted
        ? { createdByExternalIdentityId: { not: null }, expiresAt: { gt: input.revokedAt } }
        : { createdByExternalIdentityId: null }),
      prototype: {
        repositoryId: input.repositoryId,
        branchDeletedAt: null,
        repository: {
          ...(hosted
            ? { githubRepositoryId: { not: null }, localPath: null }
            : { localPath: { not: null } }),
          removedAt: null,
        },
      },
    },
    data: { revokedAt: input.revokedAt },
  })
  return result.count === 1
}
