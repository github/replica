import type { Prisma } from "../../../generated/prisma/client.ts"

export function getAdministrator(database: Prisma.TransactionClient) {
  return database.user.findFirst({
    where: { administrator: true },
    orderBy: { createdAt: "asc" },
  })
}
