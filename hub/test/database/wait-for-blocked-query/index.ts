import type pg from "pg"

export async function waitForBlockedQuery(inspector: pg.Client, blockerPid: number, query: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await inspector.query<{ pid: number }>(
      `SELECT waiter.pid
       FROM pg_stat_activity waiter
       WHERE waiter.datname = current_database()
         AND waiter.wait_event_type = 'Lock'
         AND waiter.query LIKE $2
         AND $1 = ANY(pg_blocking_pids(waiter.pid))
       LIMIT 1`,
      [blockerPid, `%${query}%`],
    )
    const waiterPid = result.rows[0]?.pid
    if (waiterPid) return waiterPid
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error(`Timed out waiting for a blocked query containing ${query}.`)
}
