import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Serializes changes that can invalidate a repository-authorized external operation.
 */
export async function lockRepositoryAdministrationChanges(
  database: Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  let previousLockTimeout: string | undefined
  if (options.timeoutMs !== undefined) {
    const [setting] = await database.$queryRaw<Array<{ lock_timeout: string }>>`
      SHOW lock_timeout
    `
    previousLockTimeout = setting?.lock_timeout
    await database.$queryRaw`
      SELECT set_config('lock_timeout', ${`${options.timeoutMs}ms`}, TRUE)
    `
  }
  await database.$executeRaw`SELECT pg_advisory_xact_lock(1919242348, 3)`
  if (previousLockTimeout !== undefined) {
    await database.$queryRaw`
      SELECT set_config('lock_timeout', ${previousLockTimeout}, TRUE)
    `
  }
}
