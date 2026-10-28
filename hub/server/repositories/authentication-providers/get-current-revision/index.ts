import type { Prisma } from "../../../generated/prisma/client.ts"

export function getCurrentAuthenticationProviderRevision(
  database: Prisma.TransactionClient,
  key: string,
) {
  return database.authenticationProviderRevision.findFirst({
    where: { authenticationProvider: { key, enabled: true } },
    orderBy: { revision: "desc" },
    include: { authenticationProvider: true },
  })
}
