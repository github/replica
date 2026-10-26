import { stateId } from "#server/utils/identity-contracts/constants"

import type { Prisma } from "../../../generated/prisma/client.ts"

export function getIdentityState(database: Prisma.TransactionClient) {
  return database.identityState.findUniqueOrThrow({ where: { id: stateId } })
}
