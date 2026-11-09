import type { Prisma } from "../../../generated/prisma/client.ts"

export function disableAuthenticationProvider(
  database: Pick<Prisma.TransactionClient, "authenticationProvider">,
  providerId: string,
) {
  return database.authenticationProvider.update({
    where: { id: providerId },
    data: { enabled: false, selectedRevisionId: null },
  })
}
