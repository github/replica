import type { Prisma } from "../../../generated/prisma/client.ts"

export async function countEffectiveAdministrators(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
) {
  const rows = await database.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) AS count
    FROM "memberships" membership
    WHERE membership."lifecycle" = 'ACTIVE'
      AND EXISTS (
        SELECT 1
        FROM "membership_assignments" assignment
        LEFT JOIN "authentication_provider_revisions" revision
          ON revision."id" = assignment."provider_revision_id"
        LEFT JOIN "authentication_providers" provider
          ON provider."id" = revision."provider_id"
        WHERE assignment."membership_id" = membership."id"
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
  `
  return Number(rows[0]?.count ?? 0)
}
