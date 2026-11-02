import type { Prisma } from "../../../generated/prisma/client.ts"

export async function createOrRestoreBootstrapAssignment(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: { externalIdentityId: string; id: string; membershipId: string },
) {
  const rows = await database.$queryRaw<Array<{ inserted: boolean }>>`
    INSERT INTO "membership_assignments" (
      "id", "membership_id", "external_identity_id", "source", "role", "lifecycle",
      "created_at", "updated_at"
    ) VALUES (
      ${input.id}::uuid,
      ${input.membershipId}::uuid,
      ${input.externalIdentityId}::uuid,
      'BOOTSTRAP',
      'ADMINISTRATOR',
      'ACTIVE',
      clock_timestamp(),
      clock_timestamp()
    )
    ON CONFLICT ("membership_id", "source", "role") DO UPDATE
    SET "external_identity_id" = EXCLUDED."external_identity_id",
        "lifecycle" = 'ACTIVE',
        "updated_at" = clock_timestamp()
    WHERE "membership_assignments"."lifecycle" <> 'ACTIVE'
       OR "membership_assignments"."external_identity_id"
          IS DISTINCT FROM EXCLUDED."external_identity_id"
    RETURNING (xmax = 0) AS "inserted"
  `
  return rows[0] ?? null
}
