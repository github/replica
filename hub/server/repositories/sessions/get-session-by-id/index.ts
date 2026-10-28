import type { Prisma } from "../../../generated/prisma/client.ts"

export function getSessionById(database: Prisma.TransactionClient, id: string) {
  return database.session.findUnique({
    where: { id },
    include: {
      user: true,
      externalIdentity: true,
      authenticationProviderRevision: { include: { authenticationProvider: true } },
    },
  })
}
