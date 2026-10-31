import type { AuthenticationRateLimitDatabase } from "../reserve-authentication-rate-limit/types.ts"

export async function markAuthenticationRateLimitAudited(
  database: AuthenticationRateLimitDatabase,
  input: { keyDigest: string; scope: "github_callback" | "github_start" },
): Promise<void> {
  await database.$executeRaw`
    UPDATE "authentication_rate_limits"
    SET "denial_audited_at" = statement_timestamp(),
        "updated_at" = statement_timestamp()
    WHERE "scope" = ${input.scope}
      AND "key_digest" = ${input.keyDigest}
  `
}
