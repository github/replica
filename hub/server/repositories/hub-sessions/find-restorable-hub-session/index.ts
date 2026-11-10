import type { Prisma } from "../../../generated/prisma/client.ts"

export async function findRestorableHubSession(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  digest: string,
) {
  const rows = await database.$queryRaw<
    Array<{
      id: string
      externalIdentityId: string | null
      membershipId: string
      revocationRevision: number
    }>
  >`
    SELECT
      "id",
      "external_identity_id" AS "externalIdentityId",
      "membership_id" AS "membershipId",
      "revocation_revision" AS "revocationRevision"
    FROM "hub_sessions"
    WHERE "digest" = ${digest}
      AND "ended_at" IS NULL
      AND "expires_at" > clock_timestamp()
  `
  return rows[0] ?? null
}
