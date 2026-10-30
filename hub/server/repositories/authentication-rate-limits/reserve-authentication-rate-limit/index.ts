import { Prisma } from "../../../generated/prisma/client.ts"
import { z } from "zod"

import type {
  AuthenticationRateLimitDatabase,
  ReserveAuthenticationRateLimitInput,
} from "./types.ts"

const inputSchema = z
  .object({
    id: z.uuid(),
    keyDigest: z.string().regex(/^[0-9a-f]{64}$/),
    limit: z.number().int().min(1).max(1_000),
    scope: z.enum(["github_callback", "github_start"]),
    windowSeconds: z.number().int().min(1).max(86_400),
  })
  .strict()

export function reserveAuthenticationRateLimit(
  database: AuthenticationRateLimitDatabase,
  input: ReserveAuthenticationRateLimitInput,
): Promise<boolean> {
  const parsed = inputSchema.parse(input)
  return database.$transaction(
    async (transaction) => {
      await transaction.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`${parsed.scope}:${parsed.keyDigest}`}, 0)
        ) IS NULL AS "locked"
      `
      await transaction.$executeRaw`
        DELETE FROM "authentication_rate_limits"
        WHERE "window_started_at" + make_interval(secs => ${parsed.windowSeconds * 2})
          <= clock_timestamp()
      `
      const reserved = await transaction.$queryRaw<Array<{ reservation_count: number }>>`
        INSERT INTO "authentication_rate_limits" (
          "id", "scope", "key_digest", "window_started_at", "reservation_count"
        ) VALUES (
          ${parsed.id}::uuid,
          ${parsed.scope},
          ${parsed.keyDigest},
          clock_timestamp(),
          1
        )
        ON CONFLICT ("scope", "key_digest") DO UPDATE SET
          "window_started_at" = CASE
            WHEN "authentication_rate_limits"."window_started_at"
              + make_interval(secs => ${parsed.windowSeconds}) <= clock_timestamp()
            THEN clock_timestamp()
            ELSE "authentication_rate_limits"."window_started_at"
          END,
          "reservation_count" = CASE
            WHEN "authentication_rate_limits"."window_started_at"
              + make_interval(secs => ${parsed.windowSeconds}) <= clock_timestamp()
            THEN 1
            ELSE "authentication_rate_limits"."reservation_count" + 1
          END,
          "updated_at" = clock_timestamp()
        WHERE "authentication_rate_limits"."window_started_at"
            + make_interval(secs => ${parsed.windowSeconds}) <= clock_timestamp()
          OR "authentication_rate_limits"."reservation_count" < ${parsed.limit}
        RETURNING "reservation_count"
      `
      return reserved.length === 1
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  )
}
