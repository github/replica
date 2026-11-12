import type { Prisma } from "../../../generated/prisma/client.ts"

export async function isSensitiveAuthorizationCurrent(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: { authorizationId: string; hubSessionId: string },
): Promise<boolean> {
  const rows = await database.$queryRaw<Array<{ id: string }>>`
    SELECT sensitive_authorization."id"
    FROM "sensitive_authorizations" sensitive_authorization
    JOIN "hub_sessions" session ON session."id" = sensitive_authorization."hub_session_id"
    JOIN "session_revocation_states" revocation ON revocation."key" = 'global'
    JOIN "authentication_provider_revisions" revision
      ON revision."id" = session."provider_revision_id"
    JOIN "authentication_providers" provider ON provider."id" = revision."provider_id"
    WHERE sensitive_authorization."id" = ${input.authorizationId}::uuid
      AND session."id" = ${input.hubSessionId}::uuid
      AND sensitive_authorization."expires_at" > clock_timestamp()
      AND sensitive_authorization."verified_at" IS NOT NULL
      AND sensitive_authorization."continued_at" IS NULL
      AND sensitive_authorization."cancelled_at" IS NULL
      AND session."ended_at" IS NULL
      AND session."expires_at" > clock_timestamp()
      AND session."revocation_revision" = revocation."revision"
      AND provider."enabled" = true
      AND provider."selected_revision_id" = revision."id"
  `
  return rows.length === 1
}
