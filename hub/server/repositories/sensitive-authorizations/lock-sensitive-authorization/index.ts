import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockSensitiveAuthorization(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  id: string,
) {
  const rows = await database.$queryRaw<
    Array<{
      actorMembershipId: string
      cancelledAt: Date | null
      continuedAt: Date | null
      expiresAt: Date
      expired: boolean
      hubSessionId: string
      operation: "DESIGNATE_ADMINISTRATORS" | "REVOKE_ADMINISTRATOR"
      targetMembershipIds: string[]
      verifiedAt: Date | null
    }>
  >`
    SELECT
      "hub_session_id" AS "hubSessionId",
      "actor_membership_id" AS "actorMembershipId",
      "operation",
      "target_membership_ids" AS "targetMembershipIds",
      "expires_at" AS "expiresAt",
      "expires_at" <= clock_timestamp() AS "expired",
      "verified_at" AS "verifiedAt",
      "continued_at" AS "continuedAt",
      "cancelled_at" AS "cancelledAt"
    FROM "sensitive_authorizations"
    WHERE "id" = ${id}::uuid
    FOR UPDATE
  `
  return rows[0] ?? null
}
