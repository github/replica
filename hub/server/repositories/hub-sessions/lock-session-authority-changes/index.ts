import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockSessionAuthorityChanges(
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
  await database.$executeRaw`SELECT pg_advisory_xact_lock(1919242348, 4)`
  if (previousLockTimeout !== undefined) {
    await database.$queryRaw`
      SELECT set_config('lock_timeout', ${previousLockTimeout}, TRUE)
    `
  }
}
