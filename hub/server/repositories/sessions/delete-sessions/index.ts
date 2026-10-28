import type { Prisma } from "../../../generated/prisma/client.ts"

export async function deleteSessions(database: Prisma.TransactionClient) {
  await database.session.deleteMany()
}
