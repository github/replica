import type { HubSession } from "#server/repositories/sessions/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function createSession(
  database: Prisma.TransactionClient,
  data: Omit<HubSession, "id">,
) {
  const identity = await database.externalIdentity.findUnique({
    where: { id: data.externalIdentityId },
    select: { userId: true },
  })
  if (identity?.userId !== data.userId) {
    throw new Error("Session external identity must belong to the Hub user.")
  }
  return database.session.create({ data })
}
