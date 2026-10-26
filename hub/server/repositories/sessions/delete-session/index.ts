import type { Prisma } from "../../../generated/prisma/client.ts"

export async function deleteSession(database: Prisma.TransactionClient, id: string) {
  await database.session.deleteMany({ where: { id } })
  await database.oAuthAttempt.deleteMany({ where: { sessionId: id } })
}
