import type { Prisma } from "../../../generated/prisma/client.ts"

export async function continueCopilotSensitiveAuthorization(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: {
    actorMembershipId: string
    authorizationId: string
    hubSessionId: string
    operation: "CONNECT_COPILOT" | "DISCONNECT_COPILOT"
  },
): Promise<boolean> {
  const rows = await database.$queryRaw<Array<{ id: string }>>`
    UPDATE "sensitive_authorizations" AS sensitive_authorization
    SET "continued_at" = clock_timestamp(), "updated_at" = clock_timestamp()
    FROM "hub_sessions" session, "copilot_connection_states" state
    WHERE sensitive_authorization."id" = ${input.authorizationId}::uuid
      AND sensitive_authorization."hub_session_id" = ${input.hubSessionId}::uuid
      AND sensitive_authorization."actor_membership_id" = ${input.actorMembershipId}::uuid
      AND sensitive_authorization."operation" = ${input.operation}::"SensitiveAuthorizationOperation"
      AND sensitive_authorization."expected_copilot_generation" = state."generation"
      AND state."key" = 'global'
      AND cardinality(sensitive_authorization."target_membership_ids") = 1
      AND sensitive_authorization."target_membership_ids"[1] = ${input.actorMembershipId}::uuid
      AND sensitive_authorization."verified_at" IS NOT NULL
      AND sensitive_authorization."continued_at" IS NULL
      AND sensitive_authorization."cancelled_at" IS NULL
      AND sensitive_authorization."expires_at" > clock_timestamp()
      AND session."id" = sensitive_authorization."hub_session_id"
      AND session."ended_at" IS NULL
      AND session."expires_at" > clock_timestamp()
    RETURNING sensitive_authorization."id"
  `
  return rows.length === 1
}
