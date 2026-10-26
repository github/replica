import type { OAuthAttempt } from "#server/repositories/oauth-attempts/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function createOAuthAttempt(
  database: Prisma.TransactionClient,
  data: Omit<OAuthAttempt, "id">,
) {
  await database.oAuthAttempt.deleteMany({ where: { expiresAt: { lte: new Date() } } })
  await database.oAuthAttempt.create({ data })
}
