import type { Prisma } from "../../../generated/prisma/client.ts"

export async function getSessionRevocationState(
  database: Pick<Prisma.TransactionClient, "sessionRevocationState">,
) {
  return database.sessionRevocationState.findUnique({
    where: { key: "global" },
    select: { revision: true },
  })
}
