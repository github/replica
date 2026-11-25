import "dotenv/config"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import pg from "pg"

import { logger } from "../../integrations/pino/index.ts"

export async function grantLearningDatabaseAccess(databaseUrl: string) {
  if (!databaseUrl) throw new Error("Learning grants require a migration database URL.")
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 })
  try {
    await client.connect()
    await client.query("BEGIN")
    await client.query("REVOKE ALL ON SCHEMA replica_learning FROM PUBLIC")
    await client.query("GRANT USAGE ON SCHEMA replica_learning TO replica_learning_runtime")
    await client.query(
      "GRANT SELECT, INSERT, UPDATE ON replica_learning.records TO replica_learning_runtime",
    )
    await client.query(
      "REVOKE UPDATE ON replica_learning.memory_versions FROM replica_learning_runtime",
    )
    await client.query(
      "GRANT SELECT, INSERT ON replica_learning.memory_versions TO replica_learning_runtime",
    )
    await client.query(
      "GRANT SELECT, INSERT ON replica_learning.scope_migrations, replica_learning.sqlite_imports TO replica_learning_runtime",
    )
    await client.query(
      "GRANT USAGE ON ALL SEQUENCES IN SCHEMA replica_learning TO replica_learning_runtime",
    )
    await client.query(
      "GRANT SELECT ON replica_learning.schema_migrations TO replica_learning_runtime",
    )
    await client.query("COMMIT")
  } finally {
    await client.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await grantLearningDatabaseAccess(process.env.REPLICA_LEARNING_MIGRATION_DATABASE_URL ?? "")
    logger.info("Learning database access granted")
  } catch {
    logger.fatal("Learning database grants failed; check migration ownership and the runtime role")
    process.exitCode = 1
  }
}
