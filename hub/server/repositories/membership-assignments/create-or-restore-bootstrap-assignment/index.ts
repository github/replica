import type { Prisma } from "../../../generated/prisma/client.ts"

export async function createOrRestoreBootstrapAssignment(
  database: Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">,
  input: { externalIdentityId: string; id: string; membershipId: string },
): Promise<"created" | "restored" | "unchanged" | null> {
  const existing = await database.$queryRaw<
    Array<{
      externalIdentityId: string
      lifecycle: "ACTIVE" | "REVOKED"
    }>
  >`
    SELECT
      "external_identity_id" AS "externalIdentityId",
      "lifecycle"::text
    FROM "membership_assignments"
    WHERE "membership_id" = ${input.membershipId}::uuid
      AND "source" = 'BOOTSTRAP'
      AND "role" = 'ADMINISTRATOR'
    FOR UPDATE
  `
  const assignment = existing[0]
  if (assignment) {
    if (assignment.externalIdentityId !== input.externalIdentityId) return null
    if (assignment.lifecycle === "ACTIVE") return "unchanged"
    await database.$executeRaw`
      UPDATE "membership_assignments"
      SET "lifecycle" = 'ACTIVE', "updated_at" = clock_timestamp()
      WHERE "membership_id" = ${input.membershipId}::uuid
        AND "source" = 'BOOTSTRAP'
        AND "role" = 'ADMINISTRATOR'
        AND "external_identity_id" = ${input.externalIdentityId}::uuid
        AND "lifecycle" = 'REVOKED'
    `
    return "restored"
  }
  await database.$executeRaw`
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
  `
  return "created"
}
