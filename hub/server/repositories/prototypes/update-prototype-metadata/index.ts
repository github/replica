import type { Prisma } from "../../../generated/prisma/client.ts"

export function updatePrototypeMetadata(
  database: Pick<Prisma.TransactionClient, "prototype">,
  id: string,
  data: {
    name?: string
    description?: string | null
    startPage?: string | null
    authorId?: string
    registeredAt?: Date
  },
) {
  return database.prototype.update({ where: { id }, data, select: { id: true } })
}
