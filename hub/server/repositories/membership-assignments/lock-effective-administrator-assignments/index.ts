import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockEffectiveAdministratorAssignments(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  membershipIds: string[],
) {
  if (!membershipIds.length) return []
  return database.$queryRaw<Array<{ id: string }>>`
    SELECT assignment."id"
    FROM "membership_assignments" assignment
    LEFT JOIN "authentication_provider_revisions" revision
      ON revision."id" = assignment."provider_revision_id"
    LEFT JOIN "authentication_providers" provider
      ON provider."id" = revision."provider_id"
    WHERE assignment."membership_id" = ANY(${membershipIds}::uuid[])
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
    ORDER BY assignment."id"
    FOR UPDATE OF assignment
  `
}
