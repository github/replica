import type { Prisma } from "../../../generated/prisma/client.ts"

export async function revokeAdministratorAssignment(
  database: Pick<Prisma.TransactionClient, "$executeRaw">,
  id: string,
) {
  const changed = await database.$executeRaw`
    UPDATE "membership_assignments"
    SET
      "lifecycle" = 'REVOKED',
      "updated_at" = GREATEST(clock_timestamp(), "updated_at" + interval '1 millisecond')
    WHERE "id" = ${id}::uuid
      AND "source" = 'HUB_ADMINISTRATOR'
      AND "role" = 'ADMINISTRATOR'
      AND "lifecycle" = 'ACTIVE'
  `
  if (changed !== 1) {
    throw new Error("The active administrator-managed assignment changed before revocation.")
  }
}
