import type { HubSession } from "#server/repositories/sessions/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export function createSession(database: Prisma.TransactionClient, data: Omit<HubSession, "id">) {
  return database.session.create({ data })
}
