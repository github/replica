import type { Prisma } from "../../../generated/prisma/client.ts"

export async function getSensitiveAuthorizationAuditData(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  id: string,
) {
  const rows = await database.$queryRaw<
    Array<{
      actorMembershipId: string
      expiresAt: Date
      expired: boolean
      operation: "DESIGNATE_ADMINISTRATORS" | "REVOKE_ADMINISTRATOR"
      targetCount: number
    }>
  >`
    SELECT
      "actor_membership_id" AS "actorMembershipId",
      "operation",
      "expires_at" AS "expiresAt",
      "expires_at" <= clock_timestamp() AS "expired",
      cardinality("target_membership_ids") AS "targetCount"
    FROM "sensitive_authorizations"
    WHERE "id" = ${id}::uuid
  `
  return rows[0] ?? null
}
