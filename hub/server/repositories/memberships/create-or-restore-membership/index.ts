import type { Prisma } from "../../../generated/prisma/client.ts"

export async function createOrRestoreMembership(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: { id: string; userId: string },
) {
  const rows = await database.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "memberships" (
      "id", "user_id", "lifecycle", "created_at", "updated_at"
    ) VALUES (
      ${input.id}::uuid, ${input.userId}::uuid, 'ACTIVE', clock_timestamp(), clock_timestamp()
    )
    ON CONFLICT ("user_id") DO UPDATE
    SET "lifecycle" = 'ACTIVE', "updated_at" = clock_timestamp()
    RETURNING "id"
  `
  return rows[0]!
}
