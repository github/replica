import type { Prisma } from "../../../generated/prisma/client.ts"

export function enableAuthenticationProvider(
  database: Pick<Prisma.TransactionClient, "authenticationProvider">,
  input: { providerId: string; revisionId: string },
) {
  return database.authenticationProvider.update({
    where: { id: input.providerId },
    data: { enabled: true, selectedRevisionId: input.revisionId },
  })
}
