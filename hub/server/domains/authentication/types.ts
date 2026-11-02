export interface IdentityPresentationAttributes {
  avatarUrl: string | null
  email: string | null
  name: string | null
  preferredUsername: string | null
}

export interface ImmutableIdentityEvidence {
  attributes: IdentityPresentationAttributes
  issuer: string
  provider: string
  subject: string
}

/**
 * Internal same-request proof for C3 admission/session orchestration.
 * C3 must not accept this shape from HTTP input. It rereads both IDs, verifies the consumed
 * attempt and immutable identity mapping, locks its admission/session aggregates, evaluates
 * admission, and writes the session plus final success audit atomically.
 */
export interface AuthenticationProofResult {
  authorizationAttemptId: string
  externalIdentityId: string
}

export interface AuthenticationProviderAdapter {
  readonly providerKey: string
  createAuthorizationUrl(input: { callbackUri: string; codeChallenge: string; state: string }): URL
  completeAuthenticationProof(input: {
    callbackUri: string
    code: string
    codeVerifier: string
  }): Promise<unknown>
}
