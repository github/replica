import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockEffectiveAdministratorProviders(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
) {
  return database.$queryRaw<Array<{ key: string }>>`
    SELECT provider."key"
    FROM "authentication_providers" provider
    WHERE provider."enabled" = true
      AND EXISTS (
        SELECT 1
        FROM "authentication_provider_revisions" revision
        JOIN "membership_assignments" assignment
          ON assignment."provider_revision_id" = revision."id"
        WHERE revision."provider_id" = provider."id"
          AND assignment."provider_revision_id" = provider."selected_revision_id"
          AND assignment."source" = 'AUTHENTICATION_PROVIDER'
          AND assignment."role" = 'ADMINISTRATOR'
          AND assignment."lifecycle" = 'ACTIVE'
      )
    ORDER BY provider."key"
    FOR SHARE
  `
}
