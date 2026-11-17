import type { Prisma } from "../../../generated/prisma/client.ts"

/** Removes the global Copilot connection if one of the memberships connected it. */
export async function disconnectCopilotConnectionForMemberships(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  membershipIds: string[],
): Promise<{ connectionId: string; credentialProvider: string } | null> {
  if (!membershipIds.length) return null
  const rows = await database.$queryRaw<
    Array<{ connectionId: string; credentialProvider: string }>
  >`
    WITH disconnected AS (
      DELETE FROM "copilot_connections"
      WHERE "key" = 'global'
        AND "connected_by_membership_id" = ANY(${membershipIds}::uuid[])
      RETURNING "id", "credential_provider"
    ),
    advanced AS (
      UPDATE "copilot_connection_states"
      SET "generation" = "generation" + 1, "updated_at" = clock_timestamp()
      WHERE "key" = 'global' AND EXISTS (SELECT 1 FROM disconnected)
    )
    SELECT "id" AS "connectionId", "credential_provider" AS "credentialProvider"
    FROM disconnected
  `
  return rows[0] ?? null
}
