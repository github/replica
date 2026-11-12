import type { Prisma } from "../../../generated/prisma/client.ts"

export async function disconnectCopilotConnectionWithoutEffectiveAdministrator(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
): Promise<{ membershipId: string } | null> {
  const rows = await database.$queryRaw<Array<{ membershipId: string }>>`
    WITH disconnected AS (
      SELECT connection."id", connection."connected_by_membership_id"
      FROM "copilot_connection_states" connection
      WHERE connection."key" = 'global'
        AND connection."connected_by_membership_id" IS NOT NULL
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
      FOR UPDATE OF connection
    )
    UPDATE "copilot_connection_states" connection
    SET
      "connected_by_membership_id" = NULL,
      "token_digest" = NULL,
      "verified_at" = NULL,
      "refused_at" = NULL,
      "generation" = "generation" + 1,
      "updated_at" = clock_timestamp()
    FROM disconnected
    WHERE connection."id" = disconnected."id"
    RETURNING disconnected."connected_by_membership_id" AS "membershipId"
  `
  return rows[0] ?? null
}
