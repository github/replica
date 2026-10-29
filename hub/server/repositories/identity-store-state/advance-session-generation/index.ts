import { staticIdentityStoreRecordId } from "#server/repositories/identity-store-state/constants"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function advanceSessionGeneration(database: Prisma.TransactionClient) {
  await database.identityStoreState.update({
    where: { id: staticIdentityStoreRecordId },
    data: { sessionGeneration: { increment: 1 } },
  })
}
