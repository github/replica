import type { Prisma } from "../../../generated/prisma/client.ts"

export async function verifySession(
  database: Prisma.TransactionClient,
  id: string,
  freshAuthorizedAt: Date,
) {
  await database.session.update({
    where: { id },
    data: { freshAuthorizedAt },
  })
}
