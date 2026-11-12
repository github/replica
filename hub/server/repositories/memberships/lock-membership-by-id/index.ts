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
    SELECT
      membership."id",
      membership."lifecycle"::text,
      membership."user_id" AS "userId"
    FROM "memberships" membership
    WHERE membership."id" = ${id}::uuid
    FOR UPDATE OF membership
  `
  return rows[0] ?? null
}
