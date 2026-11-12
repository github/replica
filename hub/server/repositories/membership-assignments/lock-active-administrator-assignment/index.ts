import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockActiveAdministratorAssignment(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  membershipId: string,
) {
  const rows = await database.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "membership_assignments"
    WHERE "membership_id" = ${membershipId}::uuid
      AND "source" = 'HUB_ADMINISTRATOR'
      AND "role" = 'ADMINISTRATOR'
      AND "lifecycle" = 'ACTIVE'
    FOR UPDATE
  `
  return rows[0] ?? null
}
