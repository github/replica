import "dotenv/config"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import pg from "pg"

import { logger } from "../../integrations/pino/index.ts"

export async function grantRuntimeDatabaseAccess(databaseUrl: string) {
  if (!databaseUrl) throw new Error("Runtime grants require DATABASE_URL.")
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 })
  try {
    await client.connect()
    await client.query("BEGIN")
    const principal = await client.query<{ name: string }>("SELECT current_user AS name")
    if (principal.rows[0]!.name !== "replica_migration") {
      throw new Error("Runtime grants require the replica_migration principal.")
    }
    // BullMQ lazily creates per-queue sequences; initialize the two allowed queues as their owner.
    await client.query("SELECT bullmq.next_job_id('on-demand'), bullmq.next_job_id('scheduled')")
    await client.query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, bullmq TO replica_runtime",
    )
    await client.query(
      "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, bullmq TO replica_runtime",
    )
    await client.query("REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public, bullmq FROM PUBLIC")
    await client.query("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, bullmq TO replica_runtime")
    await client.query(
      "REVOKE ALL ON public._prisma_migrations, bullmq.migration FROM replica_runtime",
    )
    await client.query("GRANT SELECT ON bullmq.migration TO replica_runtime")
    await client.query("COMMIT")
  } finally {
    await client.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await grantRuntimeDatabaseAccess(process.env.DATABASE_URL ?? "")
    logger.info("Runtime database access granted")
  } catch {
    logger.fatal("Runtime database grants failed; check migration ownership and the runtime role")
    process.exitCode = 1
  }
}
