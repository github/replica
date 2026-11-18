import type { PrismaClient } from "../../../generated/prisma/client.ts"

import { publicSharingSettingKey } from "../../../utils/public-sharing-setting-key/index.ts"

export function initializeSharingSetting(database: PrismaClient) {
  return database.sharingSetting.upsert({
    where: { key: publicSharingSettingKey },
    create: { key: publicSharingSettingKey },
    update: {},
  })
}
