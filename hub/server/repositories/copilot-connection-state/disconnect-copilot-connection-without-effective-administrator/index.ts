import type { Prisma } from "../../../generated/prisma/client.ts"

export async function disconnectCopilotConnectionWithoutEffectiveAdministrator(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
): Promise<{
  connectionId: string
  credentialProvider: string
  membershipId: string
} | null> {
  const rows = await database.$queryRaw<
    Array<{
      connectionId: string
      credentialProvider: string
      membershipId: string
    }>
  >`
    WITH disconnected AS (
      DELETE FROM "copilot_connections" connection
      WHERE connection."key" = 'global'
        AND NOT EXISTS (
          SELECT 1
          FROM "membership_assignments" assignment
          LEFT JOIN "authentication_provider_revisions" revision
            ON revision."id" = assignment."provider_revision_id"
          LEFT JOIN "authentication_providers" provider
            ON provider."id" = revision."provider_id"
          WHERE assignment."membership_id" = connection."connected_by_membership_id"
            AND assignment."lifecycle" = 'ACTIVE'
            AND assignment."role" = 'ADMINISTRATOR'
            AND (
              assignment."source" IN ('BOOTSTRAP', 'HUB_ADMINISTRATOR')
              OR (
                assignment."source" = 'AUTHENTICATION_PROVIDER'
                AND provider."enabled" = true
                AND provider."selected_revision_id" = assignment."provider_revision_id"
              )
            )
        )
      RETURNING
        connection."id",
        connection."connected_by_membership_id",
        connection."credential_provider"
    ),
    advanced AS (
      UPDATE "copilot_connection_states"
      SET "generation" = "generation" + 1, "updated_at" = clock_timestamp()
      WHERE "key" = 'global' AND EXISTS (SELECT 1 FROM disconnected)
    )
    SELECT
      disconnected."id" AS "connectionId",
      disconnected."connected_by_membership_id" AS "membershipId",
      disconnected."credential_provider" AS "credentialProvider"
    FROM disconnected
  `
  return rows[0] ?? null
}
