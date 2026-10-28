import type { Prisma } from "../../../generated/prisma/client.ts"

export function getAuthenticationProviderRevision(database: Prisma.TransactionClient, id: string) {
  return database.authenticationProviderRevision.findUnique({
    where: { id },
    include: { authenticationProvider: true },
  })
}
