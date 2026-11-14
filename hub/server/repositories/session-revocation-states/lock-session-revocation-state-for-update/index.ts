import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockSessionRevocationStateForUpdate(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
) {
  await database.$queryRaw`
    SELECT "revision"
    FROM "session_revocation_states"
    WHERE "key" = 'global'
    FOR UPDATE
  `
}
