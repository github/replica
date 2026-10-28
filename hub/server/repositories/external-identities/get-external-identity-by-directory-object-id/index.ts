import type { Prisma } from "../../../generated/prisma/client.ts"

export function getExternalIdentityByDirectoryObjectId(
  database: Prisma.TransactionClient,
  provider: string,
  issuer: string,
  directoryObjectId: string,
) {
  return database.externalIdentity.findUnique({
    where: {
      provider_issuer_directoryObjectId: { provider, issuer, directoryObjectId },
    },
    include: { user: true },
  })
}
