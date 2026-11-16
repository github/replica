import type { Prisma } from "../../../generated/prisma/client.ts"

export function findAuthenticationProviderRevision(
  database: Pick<Prisma.TransactionClient, "authenticationProviderRevision">,
  id: string,
) {
  return database.authenticationProviderRevision.findUnique({
    select: { configurationDigest: true, revision: true },
    where: { id },
  })
}
