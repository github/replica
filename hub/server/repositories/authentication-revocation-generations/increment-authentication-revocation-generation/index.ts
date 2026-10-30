import type { Prisma } from "../../../generated/prisma/client.ts"

export function incrementAuthenticationRevocationGeneration(
  database: Pick<Prisma.TransactionClient, "authenticationRevocationGeneration">,
) {
  return database.authenticationRevocationGeneration.update({
    where: { key: "global" },
    data: { generation: { increment: 1 } },
  })
}
