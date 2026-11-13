import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockSensitiveAuthorization(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  id: string,
) {
  const rows = await database.$queryRaw<
    Array<{
      actorMembershipId: string
      cancelledAt: Date | null
      expectedCopilotGeneration: bigint | null
      checkFinishedAt: Date | null
      checkStartedAt: Date | null
      continuedAt: Date | null
      expiresAt: Date
      expired: boolean
      hubSessionId: string
      operation:
        | "CONNECT_COPILOT"
        | "DESIGNATE_ADMINISTRATORS"
        | "DISCONNECT_COPILOT"
        | "END_ALL_HUB_SESSIONS"
        | "REVOKE_ADMINISTRATOR"
      targetMembershipIds: string[]
      verifiedAt: Date | null
    }>
  >`
    SELECT
      "hub_session_id" AS "hubSessionId",
      "actor_membership_id" AS "actorMembershipId",
      "operation",
      "target_membership_ids" AS "targetMembershipIds",
      "expected_copilot_generation" AS "expectedCopilotGeneration",
      "expires_at" AS "expiresAt",
      "expires_at" <= clock_timestamp() AS "expired",
      "verified_at" AS "verifiedAt",
      "check_finished_at" AS "checkFinishedAt",
      "check_started_at" AS "checkStartedAt",
      "continued_at" AS "continuedAt",
      "cancelled_at" AS "cancelledAt"
    FROM "sensitive_authorizations"
    WHERE "id" = ${id}::uuid
    FOR UPDATE
  `
  return rows[0] ?? null
}
