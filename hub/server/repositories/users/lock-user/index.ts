import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockUser(database: Pick<Prisma.TransactionClient, "$queryRaw">, id: string) {
  const rows = await database.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "users"
    WHERE "id" = ${id}::uuid
    FOR UPDATE
  `
  return rows[0] ?? null
}
