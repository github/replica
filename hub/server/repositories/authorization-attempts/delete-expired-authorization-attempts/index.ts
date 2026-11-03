import type { Prisma } from "../../../generated/prisma/client.ts"

export async function deleteExpiredAuthorizationAttempts(
  database: Pick<Prisma.TransactionClient, "$executeRaw">,
): Promise<void> {
  await database.$executeRaw`
    DELETE FROM "authorization_attempts"
    WHERE (
      "consumed_at" IS NULL
      AND "expires_at" <= CURRENT_TIMESTAMP
    ) OR (
      "consumed_at" <= CURRENT_TIMESTAMP - interval '10 minutes'
    )
  `
}
