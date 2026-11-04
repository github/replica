import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockAuthenticationProvidersForReconciliation(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
) {
  return database.$queryRaw<
    Array<{
      configurationDigest: string
      enabled: boolean
      id: string
      key: string
      revision: number
      revisionId: string
    }>
  >`
    SELECT
      provider."id",
      provider."key",
      provider."enabled",
      revision."id" AS "revisionId",
      revision."revision",
      revision."configuration_digest" AS "configurationDigest"
    FROM "authentication_providers" provider
    JOIN "authentication_provider_revisions" revision
      ON revision."id" = provider."selected_revision_id"
    ORDER BY provider."key"
    FOR UPDATE OF provider
  `
}
