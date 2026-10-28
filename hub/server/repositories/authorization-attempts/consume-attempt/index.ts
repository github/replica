import type { AuthorizationAttempt } from "#server/repositories/authorization-attempts/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

interface ConsumedAuthorizationAttempt extends AuthorizationAttempt {
  valid: boolean
}

export async function consumeAuthorizationAttempt(
  database: Prisma.TransactionClient,
  stateDigest: string,
): Promise<AuthorizationAttempt | null> {
  const [attempt] = await database.$queryRaw<ConsumedAuthorizationAttempt[]>`
    DELETE FROM authorization_attempts
    WHERE state_digest = ${stateDigest}
    RETURNING
      id,
      authentication_provider_revision_id AS "authenticationProviderRevisionId",
      originating_session_id AS "originatingSessionId",
      state_digest AS "stateDigest",
      browser_digest AS "browserDigest",
      pkce_verifier AS "pkceVerifier",
      nonce,
      purpose,
      session_generation AS "sessionGeneration",
      expires_at AS "expiresAt",
      expires_at > clock_timestamp() AS valid
  `
  if (!attempt) return null
  if (!attempt.valid) return null
  if (
    attempt.purpose !== "sign-in" &&
    attempt.purpose !== "verify" &&
    attempt.purpose !== "link-identity"
  ) {
    throw new Error("Stored authorization purpose is invalid.")
  }
  return {
    id: attempt.id,
    authenticationProviderRevisionId: attempt.authenticationProviderRevisionId,
    originatingSessionId: attempt.originatingSessionId,
    stateDigest: attempt.stateDigest,
    browserDigest: attempt.browserDigest,
    pkceVerifier: attempt.pkceVerifier,
    nonce: attempt.nonce,
    purpose: attempt.purpose,
    sessionGeneration: attempt.sessionGeneration,
    expiresAt: attempt.expiresAt,
  }
}
