import type { Prisma } from "../../../generated/prisma/client.ts"
import type { AuthorizationAttemptPurpose } from "../../../generated/prisma/enums.ts"

export async function lockConsumedAuthorizationAttempt(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  id: string,
) {
  const rows = await database.$queryRaw<
    Array<{
      bootstrapSecretDigest: string | null
      consumedAt: Date | null
      createdAt: Date
      providerRevisionId: string
      purpose: AuthorizationAttemptPurpose
      sessionRevocationRevision: number
    }>
  >`
    SELECT
      "consumed_at" AS "consumedAt",
      "created_at" AS "createdAt",
      "bootstrap_secret_digest" AS "bootstrapSecretDigest",
      "provider_revision_id" AS "providerRevisionId",
      "purpose"::text,
      "session_revocation_revision" AS "sessionRevocationRevision"
    FROM "authorization_attempts"
    WHERE "id" = ${id}::uuid
    FOR UPDATE
  `
  return rows[0] ?? null
}
