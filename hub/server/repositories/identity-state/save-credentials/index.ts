import { staticSettingsRecordId } from "#server/repositories/identity-state/constants"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function saveIdentityCredentials(
  database: Prisma.TransactionClient,
  encryptedCredentials: string,
) {
  await database.identityState.update({
    where: { id: staticSettingsRecordId },
    data: { encryptedCredentials },
  })
}
