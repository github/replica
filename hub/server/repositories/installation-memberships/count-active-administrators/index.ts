import type { Prisma } from "../../../generated/prisma/client.ts"

export function countActiveAdministrators(database: Prisma.TransactionClient) {
  return database.installationMembership.count({
    where: { status: "active", role: "administrator" },
  })
}
