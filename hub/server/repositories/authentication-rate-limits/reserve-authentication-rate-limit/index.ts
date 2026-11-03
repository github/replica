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

type Input = z.output<typeof inputSchema>
type Bucket = {
  count: number
  denialAuditedAt: Date | null
  expired: boolean
  id: string
}

function insertBucket(database: AuthenticationRateLimitDatabase, input: Input) {
  return database.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "authentication_rate_limits" (
      "id", "operation", "subject_digest", "window_started_at", "count", "expires_at",
      "denial_audited_at", "created_at", "updated_at"
    ) VALUES (
      gen_random_uuid(), ${input.operation}, ${input.subjectDigest},
      clock_timestamp(), 1,
      clock_timestamp() + make_interval(secs => ${input.windowSeconds}),
      NULL, clock_timestamp(), clock_timestamp()
    )
    ON CONFLICT ("operation", "subject_digest") DO NOTHING
    RETURNING "id"
  `
}

function lockBucket(database: AuthenticationRateLimitDatabase, input: Input) {
  return database.$queryRaw<Bucket[]>`
    SELECT
      "id",
      "count",
      "denial_audited_at" AS "denialAuditedAt",
      "expires_at" <= clock_timestamp() AS "expired"
    FROM "authentication_rate_limits"
    WHERE "operation" = ${input.operation}
      AND "subject_digest" = ${input.subjectDigest}
    FOR UPDATE
  `
}

function deleteExpiredBuckets(database: AuthenticationRateLimitDatabase, input: Input) {
  return database.$executeRaw`
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
}

export async function reserveAuthenticationRateLimit(
  database: AuthenticationRateLimitDatabase,
  rawInput: z.input<typeof inputSchema>,
): Promise<{ allowed: boolean; auditRequired: boolean }> {
  const input = inputSchema.parse(rawInput)
  let bucket: Bucket | undefined
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if ((await insertBucket(database, input)).length) {
      await deleteExpiredBuckets(database, input)
      return { allowed: true, auditRequired: false }
    }
    bucket = (await lockBucket(database, input))[0]
    if (bucket) break
  }
  if (!bucket) throw new Error("Authentication rate-limit bucket disappeared after conflict.")
  await deleteExpiredBuckets(database, input)
  if (bucket.expired) {
    await database.$executeRaw`
      UPDATE "authentication_rate_limits"
      SET "window_started_at" = clock_timestamp(),
          "count" = 1,
          "expires_at" = clock_timestamp() + make_interval(secs => ${input.windowSeconds}),
          "denial_audited_at" = NULL,
          "updated_at" = clock_timestamp()
      WHERE "id" = ${bucket.id}::uuid
    `
    return { allowed: true, auditRequired: false }
  }
  const count = bucket.count + 1
  const allowed = count <= input.limit
  const auditRequired = !allowed && input.auditFirstDenial && bucket.denialAuditedAt === null
  await database.$executeRaw`
    UPDATE "authentication_rate_limits"
    SET "count" = ${count},
        "denial_audited_at" = CASE
          WHEN ${auditRequired} THEN clock_timestamp()
          ELSE "denial_audited_at"
        END,
        "updated_at" = clock_timestamp()
    WHERE "id" = ${bucket.id}::uuid
  `
  return { allowed, auditRequired }
}
