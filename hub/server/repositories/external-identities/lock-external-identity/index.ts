import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockExternalIdentity(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  id: string,
) {
  const rows = await database.$queryRaw<Array<{ provider: string; userId: string }>>`
    SELECT "provider", "user_id" AS "userId"
    FROM "external_identities"
    WHERE "id" = ${id}::uuid
    FOR UPDATE
  `
  return rows[0] ?? null
}
