import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockMembershipsById(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  ids: string[],
) {
  if (!ids.length) return []
  return database.$queryRaw<Array<{ id: string; lifecycle: "ACTIVE" | "SUSPENDED" | "REMOVED" }>>`
    SELECT membership."id", membership."lifecycle"::text
    FROM "memberships" membership
    WHERE membership."id" = ANY(${ids}::uuid[])
    ORDER BY membership."id"
    FOR UPDATE OF membership
  `
}
