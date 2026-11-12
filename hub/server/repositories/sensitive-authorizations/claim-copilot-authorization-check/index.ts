import { z } from "zod"

import type { Prisma } from "../../../generated/prisma/client.ts"

const inputSchema = z
  .object({
    id: z.uuid(),
    maximumConcurrentChecks: z.number().int().min(1).max(20),
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
    UPDATE "sensitive_authorizations"
    SET "check_started_at" = clock_timestamp(), "updated_at" = clock_timestamp()
    FROM capacity
    WHERE "id" = ${parsed.id}::uuid
      AND "operation" IN ('CONNECT_COPILOT', 'DISCONNECT_COPILOT')
      AND "verified_at" IS NOT NULL
      AND "check_started_at" IS NULL
      AND "continued_at" IS NULL
      AND "cancelled_at" IS NULL
      AND "expires_at" > clock_timestamp()
      AND (
        "operation" = 'DISCONNECT_COPILOT'
        OR (
          SELECT count(*)
          FROM "sensitive_authorizations"
          WHERE "operation" = 'CONNECT_COPILOT'
            AND "check_started_at" IS NOT NULL
            AND "check_finished_at" IS NULL
            AND "check_started_at" > clock_timestamp() - interval '30 seconds'
        ) < ${parsed.maximumConcurrentChecks}
      )
    RETURNING "id"
  `
  return rows.length === 1
}
