import type { Prisma } from "../../../generated/prisma/client.ts"

export async function incrementSessionRevocationState(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
) {
  const rows = await database.$queryRaw<Array<{ revision: number }>>`
    UPDATE "session_revocation_states"
    SET
      "revision" = "revision" + 1,
      "updated_at" = clock_timestamp()
    WHERE "key" = 'global'
    RETURNING "revision"
  `
  return rows[0] ?? null
}
