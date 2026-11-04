import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockActiveMembershipAssignment(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  membershipId: string,
) {
  const rows = await database.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "membership_assignments"
    WHERE "membership_id" = ${membershipId}::uuid
      AND "source" = 'BOOTSTRAP'
      AND "role" = 'ADMINISTRATOR'
      AND "lifecycle" = 'ACTIVE'
    LIMIT 1
    FOR UPDATE
  `
  return rows.length > 0
}
