import type { Prisma } from "../../../generated/prisma/client.ts"

import { staticIdentityStoreRecordId } from "../constants.ts"

export async function completeBootstrap(
  database: Prisma.TransactionClient,
  completedAt: Date,
): Promise<boolean> {
  const updated = await database.identityStoreState.updateMany({
    where: { id: staticIdentityStoreRecordId, bootstrapCompletedAt: null },
    data: { bootstrapCompletedAt: completedAt },
  })
  return updated.count === 1
}
