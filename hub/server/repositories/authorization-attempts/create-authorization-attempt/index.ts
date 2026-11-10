import { z } from "zod"

import type {
  CreateAuthorizationAttemptDatabase,
  CreateAuthorizationAttemptInput,
} from "./types.ts"

const inputSchema = z
  .object({
    bootstrapSecretDigest: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    browserBindingDigest: z.string().regex(/^[0-9a-f]{64}$/),
    codeVerifierCiphertext: z.string().min(1).max(500),
    id: z.uuid(),
    lifetimeSeconds: z.number().int().min(1).max(3_600),
    nonceCiphertext: z.string().min(1).max(500),
    purpose: z.enum(["SIGN_IN", "ADMIN_ENROLLMENT", "ADMINISTRATOR_MANAGEMENT"]),
    providerRevisionId: z.uuid(),
    sensitiveAuthorizationId: z.uuid().optional(),
    sessionRevocationRevision: z.number().int().nonnegative(),
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
      "id", "provider_revision_id", "sensitive_authorization_id", "state_digest", "browser_binding_digest",
      "purpose", "bootstrap_secret_digest", "code_verifier_ciphertext",
      "nonce_ciphertext", "session_revocation_revision", "expires_at",
      "created_at", "updated_at"
    ) VALUES (
      ${parsed.id}::uuid,
      ${parsed.providerRevisionId}::uuid,
      ${parsed.sensitiveAuthorizationId ?? null}::uuid,
      ${parsed.stateDigest},
      ${parsed.browserBindingDigest},
      ${parsed.purpose}::"AuthorizationAttemptPurpose",
      ${parsed.bootstrapSecretDigest},
      ${parsed.codeVerifierCiphertext},
      ${parsed.nonceCiphertext},
      ${parsed.sessionRevocationRevision},
      clock_timestamp() + make_interval(secs => ${parsed.lifetimeSeconds}),
      clock_timestamp(),
      clock_timestamp()
    )
    RETURNING "expires_at"
  `
  return { expiresAt: rows[0]!.expires_at }
}
