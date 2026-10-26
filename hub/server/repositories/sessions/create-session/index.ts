import type { HubSession } from "#server/utils/identity-contracts/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export function createSession(database: Prisma.TransactionClient, data: Omit<HubSession, "id">) {
  return database.session.create({ data })
}
