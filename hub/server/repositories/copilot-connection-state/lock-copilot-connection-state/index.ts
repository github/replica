import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockCopilotConnectionState(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
) {
  const rows = await database.$queryRaw<
    Array<{
      connectedByMembershipId: string | null
      generation: bigint
    }>
  >`
    SELECT
      "connected_by_membership_id" AS "connectedByMembershipId",
      "generation"
    FROM "copilot_connection_states"
    WHERE "key" = 'global'
    FOR UPDATE
  `
  return rows[0] ?? null
}
