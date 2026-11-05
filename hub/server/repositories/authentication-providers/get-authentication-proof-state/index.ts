import type { Prisma } from "../../../generated/prisma/client.ts"

export async function getAuthenticationProofState(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  providerKey: string,
) {
  const rows = await database.$queryRaw<
    Array<{
      configurationDigest: string | null
      providerEnabled: boolean | null
      providerRevisionId: string | null
      providerRevisionNumber: number | null
      sessionRevocationRevision: number
    }>
  >`
    SELECT
      revision."configuration_digest" AS "configurationDigest",
      provider."enabled" AS "providerEnabled",
      revision."id" AS "providerRevisionId",
      revision."revision" AS "providerRevisionNumber",
      revocation."revision" AS "sessionRevocationRevision"
    FROM "session_revocation_states" revocation
    LEFT JOIN "authentication_providers" provider
      ON provider."key" = ${providerKey}
    LEFT JOIN "authentication_provider_revisions" revision
      ON revision."id" = provider."selected_revision_id"
    WHERE revocation."key" = 'global'
  `
  const state = rows[0]
  if (!state) return null
  const selectedProviderRevision =
    state.providerEnabled &&
    state.providerRevisionId &&
    state.providerRevisionNumber !== null &&
    state.configurationDigest
      ? {
          configurationDigest: state.configurationDigest,
          id: state.providerRevisionId,
          revision: state.providerRevisionNumber,
        }
      : null
  return {
    selectedProviderRevision,
    sessionRevocationRevision: state.sessionRevocationRevision,
  }
}
