import { runMigrations } from "bullmq"
import pg from "pg"

import { getJobConnection } from "../get-job-connection/index.ts"

export async function migrateJobDatabase(databaseUrl: string) {
  const client = new pg.Client(getJobConnection(databaseUrl))
  try {
    await client.connect()
    return await runMigrations(client)
  } finally {
    await client.end()
  }
}
