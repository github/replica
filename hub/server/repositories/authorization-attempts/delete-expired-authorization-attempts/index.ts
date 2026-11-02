import type { Prisma } from "../../../generated/prisma/client.ts"

export async function deleteExpiredAuthorizationAttempts(
  database: Pick<Prisma.TransactionClient, "$executeRaw">,
): Promise<void> {
  await database.$executeRaw`
    DELETE FROM "authorization_attempts"
    WHERE "expires_at" <= CURRENT_TIMESTAMP
  `
}
