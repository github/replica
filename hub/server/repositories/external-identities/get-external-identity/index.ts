import type { Prisma } from "../../../generated/prisma/client.ts"

export async function getExternalIdentity(
  database: Pick<Prisma.TransactionClient, "externalIdentity">,
  id: string,
) {
  return database.externalIdentity.findUnique({
    where: { id },
    select: { provider: true, userId: true },
  })
}
