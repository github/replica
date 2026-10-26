import type { Prisma } from "../../../generated/prisma/client.ts"

export function enrollAdministrator(database: Prisma.TransactionClient, id: string) {
  return database.user.update({ where: { id }, data: { administrator: true } })
}
