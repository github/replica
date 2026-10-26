import { staticSettingsRecordId } from "#server/repositories/identity-state/constants"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function advanceIdentityGeneration(database: Prisma.TransactionClient) {
  await database.identityState.update({
    where: { id: staticSettingsRecordId },
    data: { generation: { increment: 1 } },
  })
  await database.oAuthAttempt.deleteMany()
}
