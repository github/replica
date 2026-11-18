import type { Prisma } from "../../../generated/prisma/client.ts"

export async function endOpenHubSessionsForMembership(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  membershipId: string,
  reason?: "GITHUB_REPOSITORY_ACCESS_REVOKED",
) {
  return database.$queryRaw<Array<{ id: string }>>`
    WITH session_clock AS (
      SELECT clock_timestamp() AS value
    )
    UPDATE "hub_sessions"
    SET
      "ended_at" = (SELECT value FROM session_clock),
      "end_reason" = CASE
        WHEN ${reason ?? null}::text IS NOT NULL
          AND "external_identity_id" IN (
            SELECT "id" FROM "external_identities" WHERE "provider" = 'github'
          )
        THEN ${reason ?? null}::text
        ELSE NULL
      END,
      "updated_at" = (SELECT value FROM session_clock)
    WHERE "membership_id" = ${membershipId}::uuid
      AND "ended_at" IS NULL
    RETURNING "id"
  `
}
