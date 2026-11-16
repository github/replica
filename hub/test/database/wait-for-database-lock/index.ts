import pg from "pg"

export async function waitForDatabaseLock(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
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
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    }
    throw new Error("Timed out waiting for a competing database backend to enter a lock wait.")
  } finally {
    await client.end()
  }
}
