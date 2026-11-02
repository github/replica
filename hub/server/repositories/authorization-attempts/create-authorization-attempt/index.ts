import { z } from "zod"

import type {
  CreateAuthorizationAttemptDatabase,
  CreateAuthorizationAttemptInput,
} from "./types.ts"

const inputSchema = z
  .object({
    browserBindingDigest: z.string().regex(/^[0-9a-f]{64}$/),
    codeVerifierCiphertext: z.string().min(1).max(500),
    id: z.uuid(),
    lifetimeSeconds: z.number().int().min(1).max(3_600),
    providerRevisionId: z.uuid(),
    stateDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()

export async function createAuthorizationAttempt(
  database: CreateAuthorizationAttemptDatabase,
  input: CreateAuthorizationAttemptInput,
): Promise<{ expiresAt: Date }> {
  const parsed = inputSchema.parse(input)
  const rows = await database.$queryRaw<Array<{ expires_at: Date }>>`
    INSERT INTO "authorization_attempts" (
      "id", "provider_revision_id", "state_digest", "browser_binding_digest",
      "code_verifier_ciphertext", "expires_at",
      "created_at", "updated_at"
    ) VALUES (
      ${parsed.id}::uuid,
      ${parsed.providerRevisionId}::uuid,
      ${parsed.stateDigest},
      ${parsed.browserBindingDigest},
      ${parsed.codeVerifierCiphertext},
      clock_timestamp() + make_interval(secs => ${parsed.lifetimeSeconds}),
      clock_timestamp(),
      clock_timestamp()
    )
    RETURNING "expires_at"
  `
  return { expiresAt: rows[0]!.expires_at }
}
