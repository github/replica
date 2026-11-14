import type pg from "pg"

export async function waitForBlockedQuery(inspector: pg.Client, blockerPid: number, query: string) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
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
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for a blocked query containing ${query}.`)
}
