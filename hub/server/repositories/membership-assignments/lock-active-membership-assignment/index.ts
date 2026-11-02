import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockActiveMembershipAssignment(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  membershipId: string,
) {
  const rows = await database.$queryRaw<Array<{ role: "ADMINISTRATOR" }>>`
    SELECT "role"::text
    FROM "membership_assignments"
    WHERE "membership_id" = ${membershipId}::uuid
      AND "lifecycle" = 'ACTIVE'
    LIMIT 1
    FOR UPDATE
  `
  return rows[0] ?? null
}
