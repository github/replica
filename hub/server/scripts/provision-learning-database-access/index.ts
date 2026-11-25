import "dotenv/config"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import pg from "pg"

import { logger } from "../../integrations/pino/index.ts"

export async function provisionLearningDatabaseAccess({
  databaseUrl,
  learningPassword,
}: {
  databaseUrl: string
  learningPassword: string
}) {
  if (!databaseUrl || learningPassword.length < 16)
    throw new Error("Learning provisioning requires a database URL and a private password.")
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 })
  try {
    await client.connect()
    await client.query("BEGIN")
    const existing = await client.query<{ ready: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_namespace
         WHERE nspname = 'public' AND nspowner = (SELECT oid FROM pg_roles WHERE rolname = 'replica_migration')
       ) AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replica_runtime') AS ready`,
    )
    if (!existing.rows[0]!.ready)
      throw new Error("Learning provisioning requires an existing provisioned Hub database.")
    const database = await client.query<{ name: string }>("SELECT current_database() AS name")
    await client.query(
      `CREATE ROLE replica_learning_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${pg.escapeLiteral(learningPassword)}`,
    )
    await client.query(
      `GRANT CONNECT ON DATABASE ${pg.escapeIdentifier(database.rows[0]!.name)} TO replica_learning_runtime`,
    )
    await client.query("COMMIT")
  } finally {
    await client.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await provisionLearningDatabaseAccess({
      databaseUrl: process.env.DATABASE_URL ?? "",
      learningPassword: process.env.HUB_LEARNING_PASSWORD ?? "",
    })
    logger.info("Learning database access provisioned")
  } catch {
    logger.fatal("Learning database provisioning failed; check the existing database and roles")
    process.exitCode = 1
  }
}
