import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockActiveMembershipAssignments(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  membershipId: string,
) {
  return database.$queryRaw<
    Array<{
      id: string
      role: "MEMBER" | "ADMINISTRATOR"
      source: "BOOTSTRAP" | "AUTHENTICATION_PROVIDER"
    }>
  >`
    SELECT "id", "role"::text, "source"::text
    FROM "membership_assignments"
    WHERE "membership_id" = ${membershipId}::uuid
      AND "lifecycle" = 'ACTIVE'
    ORDER BY "id"
    FOR UPDATE
  `
}
