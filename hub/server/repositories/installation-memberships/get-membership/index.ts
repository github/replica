import type { Prisma } from "../../../generated/prisma/client.ts"

export function getInstallationMembership(database: Prisma.TransactionClient, userId: string) {
  return database.installationMembership.findUnique({ where: { userId } })
}
