import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockAdministratorManagementTargets(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  membershipIds: string[],
) {
  return database.$queryRaw<
    Array<{
      externalIdentityId: string | null
      lifecycle: "ACTIVE" | "SUSPENDED" | "REMOVED"
      membershipId: string
    }>
  >`
    SELECT
      identity."id" AS "externalIdentityId",
      membership."lifecycle"::text,
      membership."id" AS "membershipId"
    FROM "memberships" membership
    LEFT JOIN LATERAL (
      SELECT "id"
      FROM "external_identities"
      WHERE "user_id" = membership."user_id"
      ORDER BY "created_at", "id"
      LIMIT 1
    ) identity ON true
    WHERE membership."id" = ANY(${membershipIds}::uuid[])
    ORDER BY membership."id"
    FOR UPDATE OF membership
  `
}
