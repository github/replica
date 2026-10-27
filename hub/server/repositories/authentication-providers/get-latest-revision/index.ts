import type { Prisma } from "../../../generated/prisma/client.ts"

export function getLatestAuthenticationProviderRevision(
  database: Prisma.TransactionClient,
  key: string,
) {
  return database.authenticationProviderRevision.findFirst({
    where: { authenticationProvider: { key } },
    orderBy: { revision: "desc" },
    include: { authenticationProvider: true },
  })
}
