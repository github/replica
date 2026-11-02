export interface ImmutableIdentityEvidence {
  issuer: string
  provider: string
  subject: string
}

/**
 * Internal same-request proof reference. It is not request input, a session, or authority.
 * A later consumer rereads both referenced authoritative records before making decisions.
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
