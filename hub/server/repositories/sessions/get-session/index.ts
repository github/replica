import type { Prisma } from "../../../generated/prisma/client.ts"

export function getSession(database: Prisma.TransactionClient, tokenDigest: string) {
  return database.session.findUnique({
    where: { tokenDigest },
    include: {
      user: true,
      externalIdentity: true,
      authenticationProviderRevision: { include: { authenticationProvider: true } },
    },
  })
}
