import type { Prisma } from "../../../generated/prisma/client.ts"

export async function disconnectCopilotConnectionForMembership(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  membershipId: string,
): Promise<boolean> {
  const rows = await database.$queryRaw<Array<{ id: string }>>`
    UPDATE "copilot_connection_states"
    SET
      "connected_by_membership_id" = NULL,
      "token_digest" = NULL,
      "verified_at" = NULL,
      "refused_at" = NULL,
      "generation" = "generation" + 1,
      "updated_at" = clock_timestamp()
    WHERE "key" = 'global'
      AND "connected_by_membership_id" = ${membershipId}::uuid
    RETURNING "id"
  `
  return rows.length === 1
}
