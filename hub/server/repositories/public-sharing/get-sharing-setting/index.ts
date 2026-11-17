import type { PrismaClient, Prisma } from "../../../generated/prisma/client.ts"

export const publicSharingSettingKey = "public-sharing"

export function getSharingSetting(database: PrismaClient | Prisma.TransactionClient) {
  return database.sharingSetting.findUnique({ where: { key: publicSharingSettingKey } })
}
