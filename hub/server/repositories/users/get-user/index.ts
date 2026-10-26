import type { Prisma } from "../../../generated/prisma/client.ts"

export function getUser(database: Prisma.TransactionClient, id: string) {
  return database.user.findUnique({ where: { id } })
}
