import pg from "pg"

export async function resetDatabase(databaseUrl: string) {
  if (!URL.canParse(databaseUrl)) {
    throw new Error("Test database cleanup requires a valid PostgreSQL connection URL.")
  }
  const url = new URL(databaseUrl)
  const name = decodeURIComponent(url.pathname.slice(1))
  if (
    (url.protocol !== "postgresql:" && url.protocol !== "postgres:") ||
    !/^replica_test_[0-9a-f]{16}_[1-9][0-9]*$/.test(name)
  ) {
    throw new Error("Refusing to clear a database outside this test worker's namespace.")
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
  })
  await client.connect()
  try {
    const current = await client.query<{ name: string }>("SELECT current_database() AS name")
    if (current.rows[0]?.name !== name) {
      throw new Error("Connected database does not match the expected test worker database.")
    }
    const tables = await client.query<{ schemaname: string; tablename: string }>(
      "SELECT schemaname, tablename FROM pg_tables WHERE schemaname <> 'information_schema' AND schemaname !~ '^pg_' AND NOT (schemaname = 'public' AND tablename = '_prisma_migrations') AND NOT (schemaname = 'bullmq' AND tablename = 'migration')",
    )
    if (tables.rows.length) {
      const names = tables.rows.map(
        ({ schemaname, tablename }) =>
          `${pg.escapeIdentifier(schemaname)}.${pg.escapeIdentifier(tablename)}`,
      )
      await client.query(`TRUNCATE ${names.join(", ")} RESTART IDENTITY CASCADE`)
    }
  } finally {
    await client.end()
  }
}
