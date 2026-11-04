import type { Prisma } from "../../../generated/prisma/client.ts"

export function setAuthenticationProviderEnabled(
  database: Pick<Prisma.TransactionClient, "authenticationProvider">,
  input: { enabled: boolean; providerId: string },
) {
  return database.authenticationProvider.update({
    where: { id: input.providerId },
    data: { enabled: input.enabled },
  })
}
