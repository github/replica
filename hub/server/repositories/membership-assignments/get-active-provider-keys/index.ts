import type { Prisma } from "../../../generated/prisma/client.ts"

export async function getActiveProviderKeys(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  membershipId: string,
) {
  const rows = await database.$queryRaw<Array<{ key: string }>>`
    SELECT DISTINCT provider."key"
    FROM "membership_assignments" assignment
    JOIN "authentication_provider_revisions" revision
      ON revision."id" = assignment."provider_revision_id"
    JOIN "authentication_providers" provider
      ON provider."id" = revision."provider_id"
    WHERE assignment."membership_id" = ${membershipId}::uuid
      AND assignment."lifecycle" = 'ACTIVE'
      AND assignment."source" = 'AUTHENTICATION_PROVIDER'
    ORDER BY provider."key"
  `
  return rows.map((row) => row.key)
}
