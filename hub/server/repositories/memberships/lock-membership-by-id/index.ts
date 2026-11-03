import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockMembershipById(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  id: string,
) {
  const rows = await database.$queryRaw<
    Array<{
      id: string
      lifecycle: "ACTIVE" | "SUSPENDED" | "REMOVED"
      userId: string
    }>
  >`
    SELECT "id", "lifecycle"::text, "user_id" AS "userId"
    FROM "memberships"
    WHERE "id" = ${id}::uuid
    FOR UPDATE
  `
  return rows[0] ?? null
}
