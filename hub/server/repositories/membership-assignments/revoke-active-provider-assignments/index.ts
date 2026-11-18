import type { Prisma } from "../../../generated/prisma/client.ts"

/** Revokes every active provider assignment for the identities, locking them in ID order. */
export async function revokeActiveProviderAssignments(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  externalIdentityIds: string[],
) {
  if (!externalIdentityIds.length) return []
  return database.$queryRaw<
    Array<{ id: string; membershipId: string; role: "MEMBER" | "ADMINISTRATOR" }>
  >`
    WITH locked AS (
      SELECT "id"
      FROM "membership_assignments"
      WHERE "external_identity_id" = ANY(${externalIdentityIds}::uuid[])
        AND "source" = 'AUTHENTICATION_PROVIDER'
        AND "lifecycle" = 'ACTIVE'
      ORDER BY "id"
      FOR UPDATE
    )
    UPDATE "membership_assignments" assignment
    SET
      "lifecycle" = 'REVOKED',
      "updated_at" = GREATEST(clock_timestamp(), assignment."updated_at" + interval '1 millisecond')
    FROM locked
    WHERE assignment."id" = locked."id"
    RETURNING
      assignment."id",
      assignment."membership_id" AS "membershipId",
      assignment."role"::text AS "role"
  `
}
