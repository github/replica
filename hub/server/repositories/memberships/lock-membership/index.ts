import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockMembership(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  userId: string,
) {
  const rows = await database.$queryRaw<
    Array<{ id: string; lifecycle: "ACTIVE" | "SUSPENDED" | "REMOVED" }>
  >`
    SELECT "id", "lifecycle"::text
    FROM "memberships"
    WHERE "user_id" = ${userId}::uuid
    FOR UPDATE
  `
  return rows[0] ?? null
}
