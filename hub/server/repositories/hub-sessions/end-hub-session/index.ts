import type { Prisma } from "../../../generated/prisma/client.ts"

export async function endHubSessionRecord(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  digest: string,
) {
  const rows = await database.$queryRaw<Array<{ id: string; membershipId: string }>>`
    UPDATE "hub_sessions"
    SET "ended_at" = clock_timestamp(), "updated_at" = clock_timestamp()
    WHERE "digest" = ${digest}
      AND "ended_at" IS NULL
    RETURNING "id", "membership_id" AS "membershipId"
  `
  return rows[0] ?? null
}
