import pg from "pg"

export async function waitForDatabaseLock(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = await client.query<{ waiting: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM pg_stat_activity
           WHERE datname = current_database()
             AND pid <> pg_backend_pid()
             AND wait_event_type = 'Lock'
         ) AS waiting`,
      )
      if (result.rows[0]?.waiting) return
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    throw new Error("A competing database backend did not enter a lock wait.")
  } finally {
    await client.end()
  }
}
