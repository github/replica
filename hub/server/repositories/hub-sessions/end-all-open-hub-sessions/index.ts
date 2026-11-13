import type { Prisma } from "../../../generated/prisma/client.ts"

export async function endAllOpenHubSessions(database: Pick<Prisma.TransactionClient, "$queryRaw">) {
  const rows = await database.$queryRaw<Array<{ count: bigint }>>`
    WITH session_clock AS (
      SELECT clock_timestamp() AS value
    ),
    ended AS (
      UPDATE "hub_sessions"
      SET
        "ended_at" = (SELECT value FROM session_clock),
        "updated_at" = (SELECT value FROM session_clock)
      WHERE "ended_at" IS NULL
      RETURNING "id"
    )
    SELECT count(*) AS "count" FROM ended
  `
  return Number(rows[0]?.count ?? 0)
}
