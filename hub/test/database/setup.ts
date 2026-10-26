import { beforeEach, inject } from "vitest"

import { getWorkerDatabase } from "./get-worker-database/index.ts"
import { resetDatabase } from "./reset-database/index.ts"

const databaseUrl = getWorkerDatabase(inject("testDatabase"), process.env.VITEST_POOL_ID)
process.env.DATABASE_URL = databaseUrl

beforeEach(async () => {
  process.env.DATABASE_URL = databaseUrl
  await resetDatabase(databaseUrl)
})
