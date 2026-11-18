import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Serializes repository-authority changes against external learning operations.
 * The matching shared session lock is held outside database transactions while a
 * package command runs, so provider evidence cannot be revoked mid-mutation.
 */
export async function lockRepositoryAdministrationChanges(
  database: Pick<Prisma.TransactionClient, "$executeRaw">,
): Promise<void> {
  await database.$executeRaw`SELECT pg_advisory_xact_lock(1919242348, 3)`
}
