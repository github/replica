import type { PrismaClient, Prisma } from "../../../generated/prisma/client.ts"

import { publicSharingSettingKey } from "../../../utils/public-sharing-setting-key/index.ts"

export function getSharingSetting(database: PrismaClient | Prisma.TransactionClient) {
  return database.sharingSetting.findUnique({ where: { key: publicSharingSettingKey } })
}
