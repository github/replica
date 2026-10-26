import { staticSettingsRecordId } from "#server/repositories/identity-state/constants"

import type { Prisma } from "../../../generated/prisma/client.ts"

export function getIdentityState(database: Prisma.TransactionClient) {
  return database.identityState.findUniqueOrThrow({ where: { id: staticSettingsRecordId } })
}
