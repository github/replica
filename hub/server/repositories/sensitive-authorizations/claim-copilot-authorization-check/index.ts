import { z } from "zod"

import type { Prisma } from "../../../generated/prisma/client.ts"

const inputSchema = z
  .object({
    id: z.uuid(),
    hubSessionId: z.uuid(),
    maximumConcurrentChecks: z.number().int().min(1).max(20),
    operation: z.enum(["CONNECT_COPILOT", "DISCONNECT_COPILOT"]),
  })
  .strict()

export async function claimCopilotAuthorizationCheck(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: z.input<typeof inputSchema>,
): Promise<boolean> {
  const parsed = inputSchema.parse(input)
  const rows = await database.$queryRaw<Array<{ id: string }>>`
    WITH capacity AS (
      SELECT pg_advisory_xact_lock(hashtext('replica_copilot_authorization_checks'))
    )
    UPDATE "sensitive_authorizations" authorization
    SET "check_started_at" = clock_timestamp(), "updated_at" = clock_timestamp()
    FROM capacity, "hub_sessions" session, "copilot_connection_states" state
    WHERE authorization."id" = ${parsed.id}::uuid
      AND authorization."hub_session_id" = ${parsed.hubSessionId}::uuid
      AND authorization."operation" = ${parsed.operation}::"SensitiveAuthorizationOperation"
      AND authorization."expected_copilot_generation" = state."generation"
      AND state."key" = 'global'
      AND authorization."verified_at" IS NOT NULL
      AND authorization."check_started_at" IS NULL
      AND authorization."continued_at" IS NULL
      AND authorization."cancelled_at" IS NULL
      AND authorization."expires_at" > clock_timestamp()
      AND session."id" = authorization."hub_session_id"
      AND session."ended_at" IS NULL
      AND session."expires_at" > clock_timestamp()
      AND (
        authorization."operation" = 'DISCONNECT_COPILOT'
        OR (
          SELECT count(*)
          FROM "sensitive_authorizations"
          WHERE "operation" = 'CONNECT_COPILOT'
            AND "check_started_at" IS NOT NULL
            AND "check_finished_at" IS NULL
            AND "check_started_at" > clock_timestamp() - interval '30 seconds'
        ) < ${parsed.maximumConcurrentChecks}
      )
    RETURNING authorization."id"
  `
  return rows.length === 1
}
