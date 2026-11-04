import "dotenv/config"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import pg from "pg"

import { logger } from "../../integrations/pino/index.ts"

export async function provisionDatabaseAccess({
  databaseUrl,
  migrationPassword,
  runtimePassword,
}: {
  databaseUrl: string
  migrationPassword: string
  runtimePassword: string
}) {
  if (!databaseUrl || migrationPassword.length < 16 || runtimePassword.length < 16) {
    throw new Error(
      "Database provisioning requires a URL and two passwords of at least 16 characters.",
    )
  }
  if (migrationPassword === runtimePassword) {
    throw new Error("Database provisioning requires different migration and runtime passwords.")
  }
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 })
  try {
    await client.connect()
    await client.query("BEGIN")
    const existing = await client.query<{ populated: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) AS populated",
    )
    if (existing.rows[0]!.populated) {
      throw new Error("Database access provisioning requires an empty public schema.")
    }
    const database = await client.query<{ name: string }>("SELECT current_database() AS name")
    const name = pg.escapeIdentifier(database.rows[0]!.name)
    // Existing roles are deliberately rejected rather than adopting unknown grants or ownership.
    await client.query(
      `CREATE ROLE replica_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${pg.escapeLiteral(migrationPassword)}`,
    )
    await client.query(
      `CREATE ROLE replica_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${pg.escapeLiteral(runtimePassword)}`,
    )
    await client.query("GRANT replica_migration TO CURRENT_USER")
    await client.query(`REVOKE CREATE, TEMPORARY ON DATABASE ${name} FROM PUBLIC`)
    await client.query(
      `GRANT CONNECT, TEMPORARY ON DATABASE ${name} TO replica_migration, replica_runtime`,
    )
    await client.query(`GRANT CREATE ON DATABASE ${name} TO replica_migration`)
    await client.query("ALTER SCHEMA public OWNER TO replica_migration")
    await client.query("REVOKE ALL ON SCHEMA public FROM PUBLIC")
    await client.query("CREATE SCHEMA bullmq AUTHORIZATION replica_migration")
    await client.query("GRANT USAGE ON SCHEMA public, bullmq TO replica_runtime")
    await client.query("COMMIT")
  } finally {
    // Closing also rolls back failed provisioning, including role creation.
    await client.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await provisionDatabaseAccess({
      databaseUrl: process.env.DATABASE_URL ?? "",
      migrationPassword: process.env.HUB_MIGRATION_PASSWORD ?? "",
      runtimePassword: process.env.HUB_RUNTIME_PASSWORD ?? "",
    })
    logger.info("Database access provisioned")
  } catch {
    logger.fatal("Database access provisioning failed; check initial database ownership and roles")
    process.exitCode = 1
  }
}
