import { z } from "zod"
import { Prisma } from "../../../generated/prisma/client.ts"

import type {
  ConsumeAuthorizationAttemptDatabase,
  ConsumeAuthorizationAttemptInput,
} from "./types.ts"

const inputSchema = z
  .object({
    browserBindingDigest: z.string().regex(/^[0-9a-f]{64}$/),
    stateDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()

export async function consumeAuthorizationAttempt(
  database: ConsumeAuthorizationAttemptDatabase,
  input: ConsumeAuthorizationAttemptInput,
) {
  const parsed = inputSchema.parse(input)
  return database.$transaction(
    async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "authorization_attempts"
        WHERE "state_digest" = ${parsed.stateDigest}
        FOR UPDATE
      `
      if (!locked.length) return null
      const consumed = await transaction.$queryRaw<
        Array<{
          id: string
          code_verifier_ciphertext: string
          created_at: Date
          nonce_ciphertext: string | null
          purpose: "SIGN_IN" | "ADMIN_ENROLLMENT" | "ADMINISTRATOR_MANAGEMENT"
          provider_revision_id: string
          sensitive_authorization_id: string | null
          session_revocation_revision: number
        }>
      >`
        UPDATE "authorization_attempts"
        SET "consumed_at" = clock_timestamp(), "updated_at" = clock_timestamp()
        WHERE "state_digest" = ${parsed.stateDigest}
          AND "browser_binding_digest" = ${parsed.browserBindingDigest}
          AND "consumed_at" IS NULL
          AND "expires_at" > clock_timestamp()
        RETURNING
          "id",
          "code_verifier_ciphertext",
          "created_at",
          "nonce_ciphertext",
          "purpose",
          "provider_revision_id",
          "sensitive_authorization_id",
          "session_revocation_revision"
      `
      const attempt = consumed[0]
      return attempt
        ? {
            id: attempt.id,
            codeVerifierCiphertext: attempt.code_verifier_ciphertext,
            createdAt: attempt.created_at,
            nonceCiphertext: attempt.nonce_ciphertext,
            purpose: attempt.purpose,
            providerRevisionId: attempt.provider_revision_id,
            ...(attempt.sensitive_authorization_id
              ? { sensitiveAuthorizationId: attempt.sensitive_authorization_id }
              : {}),
            sessionRevocationRevision: attempt.session_revocation_revision,
          }
        : null
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  )
}
