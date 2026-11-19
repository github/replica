import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { lockSharingSetting } from "../../../repositories/public-sharing/lock-sharing-setting/index.ts"
import { revokeAllShareLinks } from "../../../repositories/public-sharing/revoke-all-share-links/index.ts"
import { updateSharingSetting } from "../../../repositories/public-sharing/update-sharing-setting/index.ts"
import { hostedPublicSharingSettingKey } from "../../../utils/public-sharing-setting-key/index.ts"

export function configureHostedSharingPolicy(database: PrismaClient, enabled: boolean) {
  return database.$transaction(async (transaction) => {
    const current = await lockSharingSetting(transaction, hostedPublicSharingSettingKey)
    if (!current || current.publicSharingEnabled === enabled) return
    await updateSharingSetting(transaction, { id: current.id, enabled })
    if (!enabled) await revokeAllShareLinks(transaction, new Date(), true)
  })
}
