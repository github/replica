import { staticIdentityStoreRecordId } from "#server/repositories/identity-store-state/constants"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function getBootstrapCompletedAt(database: Prisma.TransactionClient) {
  const state = await database.identityStoreState.findUniqueOrThrow({
    where: { id: staticIdentityStoreRecordId },
    select: { bootstrapCompletedAt: true },
  })
  return state.bootstrapCompletedAt
}
