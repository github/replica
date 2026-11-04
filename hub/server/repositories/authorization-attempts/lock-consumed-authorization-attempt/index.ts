import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockConsumedAuthorizationAttempt(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  id: string,
) {
  const rows = await database.$queryRaw<
    Array<{
      bootstrapSecretDigest: string | null
      consumedAt: Date | null
      providerRevisionId: string
      purpose: "SIGN_IN" | "ADMIN_ENROLLMENT"
    }>
  >`
    SELECT
      "consumed_at" AS "consumedAt",
      "bootstrap_secret_digest" AS "bootstrapSecretDigest",
      "provider_revision_id" AS "providerRevisionId",
      "purpose"::text
    FROM "authorization_attempts"
    WHERE "id" = ${id}::uuid
    FOR UPDATE
  `
  return rows[0] ?? null
}
