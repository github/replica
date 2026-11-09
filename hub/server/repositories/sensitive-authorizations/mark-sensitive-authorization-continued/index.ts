import type { Prisma } from "../../../generated/prisma/client.ts"

export async function markSensitiveAuthorizationContinued(
  database: Pick<Prisma.TransactionClient, "$executeRaw">,
  id: string,
): Promise<void> {
  await database.$executeRaw`
    UPDATE "sensitive_authorizations"
    SET "continued_at" = clock_timestamp(), "updated_at" = clock_timestamp()
    WHERE "id" = ${id}::uuid
  `
}
