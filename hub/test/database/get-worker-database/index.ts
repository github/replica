import type { TestDatabaseContext } from "../global-setup/types.ts"

export function getWorkerDatabase(database: TestDatabaseContext, poolId: string | undefined) {
  if (
    !/^replica_test_[0-9a-f]{16}$/.test(database.prefix) ||
    !Number.isSafeInteger(database.workers) ||
    database.workers < 1
  ) {
    throw new Error("Test database configuration requires a unique run prefix and worker count.")
  }
  if (!poolId || !/^[1-9][0-9]*$/.test(poolId) || Number(poolId) > database.workers) {
    throw new Error("VITEST_POOL_ID must identify a configured test database worker.")
  }

  if (!URL.canParse(database.adminUrl)) {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL connection URL.")
  }
  const url = new URL(database.adminUrl)
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("TEST_DATABASE_URL must use PostgreSQL.")
  }
  url.pathname = `${database.prefix}_${poolId}`
  return url.toString()
}
