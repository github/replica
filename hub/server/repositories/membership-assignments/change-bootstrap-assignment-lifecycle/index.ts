import type { Prisma } from "../../../generated/prisma/client.ts"

export async function changeBootstrapAssignmentLifecycle(
  database: Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">,
  input: { id: string; lifecycle: "ACTIVE" | "REVOKED" },
): Promise<{ membershipId: string; transition: "changed" | "unchanged" } | null> {
  const rows = await database.$queryRaw<
    Array<{
      lifecycle: "ACTIVE" | "REVOKED"
      membershipId: string
    }>
  >`
    SELECT
      "membership_id" AS "membershipId",
      "lifecycle"::text
    FROM "membership_assignments"
    WHERE "id" = ${input.id}::uuid
      AND "source" = 'BOOTSTRAP'
      AND "role" = 'ADMINISTRATOR'
    FOR UPDATE
  `
  const assignment = rows[0]
  if (!assignment) return null
  if (assignment.lifecycle === input.lifecycle) {
    return { membershipId: assignment.membershipId, transition: "unchanged" }
  }
  await database.$executeRaw`
    UPDATE "membership_assignments"
    SET "lifecycle" = ${input.lifecycle}::"MembershipAssignmentLifecycle",
        "updated_at" = clock_timestamp()
    WHERE "id" = ${input.id}::uuid
  `
  return { membershipId: assignment.membershipId, transition: "changed" }
}
