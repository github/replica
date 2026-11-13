import type { Prisma } from "../../../generated/prisma/client.ts"

export async function endOpenHubSessionsForMembership(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  membershipId: string,
) {
  return database.$queryRaw<Array<{ id: string }>>`
    WITH session_clock AS (
      SELECT clock_timestamp() AS value
    )
    UPDATE "hub_sessions"
    SET
      "ended_at" = (SELECT value FROM session_clock),
      "updated_at" = (SELECT value FROM session_clock)
    WHERE "membership_id" = ${membershipId}::uuid
      AND "ended_at" IS NULL
    RETURNING "id"
  `
}
