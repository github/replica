import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockSessionRevocationStateForUpdate(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
) {
  const rows = await database.$queryRaw<Array<{ revision: number }>>`
    SELECT "revision"
    FROM "session_revocation_states"
    WHERE "key" = 'global'
    FOR UPDATE
  `
  return rows[0] ?? null
}
