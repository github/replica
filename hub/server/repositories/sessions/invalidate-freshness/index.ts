import type { Prisma } from "../../../generated/prisma/client.ts"

export async function invalidateFreshness(database: Prisma.TransactionClient) {
  await database.session.updateMany({ data: { freshAuthorizedAt: null } })
}
