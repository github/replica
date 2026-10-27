import { staticIdentityStoreRecordId } from "#server/repositories/identity-store-state/constants"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function getIdentityStoreState(database: Prisma.TransactionClient) {
  return database.identityStoreState.findUniqueOrThrow({
    where: { id: staticIdentityStoreRecordId },
    select: { sessionGeneration: true },
  })
}
