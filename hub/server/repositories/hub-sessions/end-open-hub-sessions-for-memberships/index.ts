import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Ends every open session for the memberships. GitHub sessions of
 * `noRepositoryAccessMembershipIds` record why they ended; others have no reason.
 */
export async function endOpenHubSessionsForMemberships(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: { membershipIds: string[]; noRepositoryAccessMembershipIds: string[] },
) {
  if (!input.membershipIds.length) return []
  return database.$queryRaw<Array<{ id: string; membershipId: string }>>`
    WITH session_clock AS (
      SELECT clock_timestamp() AS value
    )
    UPDATE "hub_sessions"
    SET
      "ended_at" = (SELECT value FROM session_clock),
      "end_reason" = CASE
        WHEN "membership_id" = ANY(${input.noRepositoryAccessMembershipIds}::uuid[])
          AND "external_identity_id" IN (
            SELECT "id" FROM "external_identities" WHERE "provider" = 'github'
          )
        THEN 'GITHUB_REPOSITORY_ACCESS_REVOKED'
        ELSE NULL
      END,
      "updated_at" = (SELECT value FROM session_clock)
    WHERE "membership_id" = ANY(${input.membershipIds}::uuid[])
      AND "ended_at" IS NULL
    RETURNING "id", "membership_id" AS "membershipId"
  `
}
