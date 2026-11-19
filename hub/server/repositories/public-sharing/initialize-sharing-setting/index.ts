import type { PrismaClient } from "../../../generated/prisma/client.ts"

import { publicSharingSettingKey } from "../../../utils/public-sharing-setting-key/index.ts"

export function initializeSharingSetting(database: PrismaClient, key = publicSharingSettingKey) {
  return database.sharingSetting.upsert({
    where: { key },
    create: { key },
    update: {},
  })
}
