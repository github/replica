import type { Prisma } from "../../../generated/prisma/client.ts"

export async function deleteUserSessions(database: Prisma.TransactionClient, userId: string) {
  await database.session.deleteMany({ where: { userId } })
}
