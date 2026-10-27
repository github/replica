import type { AuthorizationAttempt } from "#server/repositories/authorization-attempts/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function createAuthorizationAttempt(
  database: Prisma.TransactionClient,
  data: Omit<AuthorizationAttempt, "id">,
) {
  await database.authorizationAttempt.deleteMany({ where: { expiresAt: { lte: new Date() } } })
  await database.authorizationAttempt.create({ data })
}
