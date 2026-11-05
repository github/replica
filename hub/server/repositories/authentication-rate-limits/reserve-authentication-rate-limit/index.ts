import { z } from "zod"
import type { AuthenticationRateLimitDatabase } from "./types.ts"

const inputSchema = z
  .object({
    auditFirstDenial: z.boolean(),
    limit: z.number().int().min(1).max(1_000),
    operation: z.string().min(1).max(50),
    subjectDigest: z.string().regex(/^[0-9a-f]{64}$/),
    windowSeconds: z.number().int().min(1).max(86_400),
  })
  .strict()

export async function reserveAuthenticationRateLimit(
  database: AuthenticationRateLimitDatabase,
  rawInput: z.input<typeof inputSchema>,
): Promise<{ allowed: boolean; auditRequired: boolean }> {
  const input = inputSchema.parse(rawInput)
  const [decision] = await database.$queryRaw<Array<{ allowed: boolean; auditRequired: boolean }>>`
    WITH reservation_clock AS (
      SELECT clock_timestamp() AS value
    )
    INSERT INTO "authentication_rate_limits" (
      "id", "operation", "subject_digest", "count", "expires_at",
      "denial_audited_at", "created_at", "updated_at"
    )
    SELECT
      gen_random_uuid(), ${input.operation}, ${input.subjectDigest}, 1,
      value + make_interval(secs => ${input.windowSeconds}),
      NULL, value, value
    FROM reservation_clock
    ON CONFLICT ("operation", "subject_digest") DO UPDATE
    SET
      "count" = CASE
        WHEN "authentication_rate_limits"."expires_at" <= (SELECT value FROM reservation_clock)
          THEN 1
        ELSE "authentication_rate_limits"."count" + 1
      END,
      "expires_at" = CASE
        WHEN "authentication_rate_limits"."expires_at" <= (SELECT value FROM reservation_clock)
          THEN (SELECT value FROM reservation_clock) + make_interval(secs => ${input.windowSeconds})
        ELSE "authentication_rate_limits"."expires_at"
      END,
      "denial_audited_at" = CASE
        WHEN "authentication_rate_limits"."expires_at" <= (SELECT value FROM reservation_clock)
          THEN NULL
        WHEN "authentication_rate_limits"."count" + 1 > ${input.limit}
          AND ${input.auditFirstDenial}
          AND "authentication_rate_limits"."denial_audited_at" IS NULL
          THEN GREATEST(
            (SELECT value FROM reservation_clock),
            "authentication_rate_limits"."updated_at" + interval '1 millisecond'
          )
        ELSE "authentication_rate_limits"."denial_audited_at"
      END,
      "updated_at" = GREATEST(
        (SELECT value FROM reservation_clock),
        "authentication_rate_limits"."updated_at" + interval '1 millisecond'
      )
    RETURNING
      "count" <= ${input.limit} AS "allowed",
      "count" > ${input.limit}
        AND ${input.auditFirstDenial}
        AND "denial_audited_at" = "updated_at" AS "auditRequired"
  `
  if (!decision) throw new Error("Authentication rate-limit reservation returned no decision.")

  await database.$executeRaw`
    DELETE FROM "authentication_rate_limits"
    WHERE "id" IN (
      SELECT "id"
      FROM "authentication_rate_limits"
      WHERE "expires_at" <= clock_timestamp()
        AND NOT (
          "operation" = ${input.operation}
          AND "subject_digest" = ${input.subjectDigest}
        )
      ORDER BY "expires_at", "id"
      LIMIT 100
      FOR UPDATE SKIP LOCKED
    )
  `
  return decision
}
