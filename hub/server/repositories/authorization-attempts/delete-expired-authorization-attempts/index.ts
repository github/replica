import type { Prisma } from "../../../generated/prisma/client.ts"

export async function deleteExpiredAuthorizationAttempts(
  database: Pick<Prisma.TransactionClient, "authorizationAttempt">,
  now: Date,
): Promise<void> {
  await database.authorizationAttempt.deleteMany({ where: { expiresAt: { lte: now } } })
}
