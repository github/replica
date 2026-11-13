import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockCopilotConnectionState(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
) {
  const rows = await database.$queryRaw<Array<{ generation: bigint }>>`
    SELECT "generation"
    FROM "copilot_connection_states"
    WHERE "key" = 'global'
    FOR UPDATE
  `
  return rows[0] ?? null
}
