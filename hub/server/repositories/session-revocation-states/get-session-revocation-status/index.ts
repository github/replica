import type { Prisma } from "../../../generated/prisma/client.ts"

export async function getSessionRevocationStatus(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
) {
  const rows = await database.$queryRaw<
    Array<{
      activeSessionCount: bigint
      pendingAuthenticationCount: bigint
      pendingSensitiveAuthorizationCount: bigint
      revision: number
    }>
  >`
    SELECT
      revocation."revision",
      (
        SELECT count(*)
        FROM "hub_sessions" session
        WHERE session."ended_at" IS NULL
          AND session."expires_at" > clock_timestamp()
          AND session."revocation_revision" = revocation."revision"
      ) AS "activeSessionCount",
      (
        SELECT count(*)
        FROM "authorization_attempts" attempt
        WHERE attempt."consumed_at" IS NULL
          AND attempt."expires_at" > clock_timestamp()
          AND attempt."session_revocation_revision" = revocation."revision"
      ) AS "pendingAuthenticationCount",
      (
        SELECT count(*)
        FROM "sensitive_authorizations" sensitive_authorization
        JOIN "hub_sessions" session ON session."id" = sensitive_authorization."hub_session_id"
        WHERE sensitive_authorization."continued_at" IS NULL
          AND sensitive_authorization."cancelled_at" IS NULL
          AND sensitive_authorization."expires_at" > clock_timestamp()
          AND session."ended_at" IS NULL
          AND session."expires_at" > clock_timestamp()
          AND session."revocation_revision" = revocation."revision"
      ) AS "pendingSensitiveAuthorizationCount"
    FROM "session_revocation_states" revocation
    WHERE revocation."key" = 'global'
  `
  const status = rows[0]
  return status
    ? {
        activeSessionCount: Number(status.activeSessionCount),
        pendingAuthenticationCount: Number(status.pendingAuthenticationCount),
        pendingSensitiveAuthorizationCount: Number(status.pendingSensitiveAuthorizationCount),
        revision: status.revision,
      }
    : null
}
