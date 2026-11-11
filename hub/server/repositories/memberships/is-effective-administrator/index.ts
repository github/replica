import type { Prisma } from "../../../generated/prisma/client.ts"

export async function isEffectiveAdministrator(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  membershipId: string,
) {
  const rows = await database.$queryRaw<Array<{ effective: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM "memberships" membership
      JOIN "membership_assignments" assignment
        ON assignment."membership_id" = membership."id"
      LEFT JOIN "authentication_provider_revisions" revision
        ON revision."id" = assignment."provider_revision_id"
      LEFT JOIN "authentication_providers" provider
        ON provider."id" = revision."provider_id"
      WHERE membership."id" = ${membershipId}::uuid
        AND membership."lifecycle" = 'ACTIVE'
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
    ) AS "effective"
  `
  return rows[0]?.effective ?? false
}
