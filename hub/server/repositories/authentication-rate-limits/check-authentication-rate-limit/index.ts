import { z } from "zod"

const inputSchema = z
  .object({
    limit: z.number().int().min(1).max(1_000),
    operation: z.string().min(1).max(50),
    subjectDigest: z.string().regex(/^[0-9a-f]{64}$/),
    windowSeconds: z.number().int().min(1).max(86_400),
  })
  .strict()

export async function checkAuthenticationRateLimit(
  rawInput: z.input<typeof inputSchema>,
  database: {
    $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>
    $queryRaw<Result = unknown>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<Result>
  },
): Promise<boolean> {
  const input = inputSchema.parse(rawInput)
  await database.$executeRaw`
    DELETE FROM "authentication_rate_limits"
    WHERE "id" IN (
      SELECT "id"
      FROM "authentication_rate_limits"
      WHERE "expires_at" <= clock_timestamp()
      ORDER BY "expires_at", "id"
      LIMIT 100
      FOR UPDATE SKIP LOCKED
    )
  `
  const rows = await database.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "authentication_rate_limits" (
      "id", "operation", "subject_digest", "window_started_at", "count", "expires_at",
      "created_at", "updated_at"
    ) VALUES (
      gen_random_uuid(),
      ${input.operation},
      ${input.subjectDigest},
      clock_timestamp(),
      1,
      clock_timestamp() + make_interval(secs => ${input.windowSeconds}),
      clock_timestamp(),
      clock_timestamp()
    )
    ON CONFLICT ("operation", "subject_digest") DO UPDATE
    SET "count" = CASE
          WHEN "authentication_rate_limits"."expires_at" <= clock_timestamp() THEN 1
          ELSE "authentication_rate_limits"."count" + 1
        END,
        "window_started_at" = CASE
          WHEN "authentication_rate_limits"."expires_at" <= clock_timestamp()
            THEN clock_timestamp()
          ELSE "authentication_rate_limits"."window_started_at"
        END,
        "expires_at" = CASE
          WHEN "authentication_rate_limits"."expires_at" <= clock_timestamp()
            THEN clock_timestamp() + make_interval(secs => ${input.windowSeconds})
          ELSE "authentication_rate_limits"."expires_at"
        END,
        "updated_at" = clock_timestamp()
    RETURNING "count"
  `
  return rows[0]!.count <= input.limit
}
