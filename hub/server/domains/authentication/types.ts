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
 * C3 must not accept this shape from HTTP input. Its transaction locks provider selection,
 * then revocation generation, rechecks both references, verifies the immutable identity tuple,
 * evaluates admission, and writes the session plus final success audit atomically.
 */
export interface AuthenticationProofResult {
  attributes: IdentityPresentationAttributes
  expectedRevocationGeneration: bigint
  externalIdentityId: string
  issuer: string
  providerKey: string
  providerRevisionId: string
  subject: string
  userId: string
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

export interface GitHubAuthenticationServices {
  appOrigin: string
  complete(input: { browserBinding: string; code: string; state: string }): Promise<{
    proof: AuthenticationProofResult
  }>
  reserveRateLimit(input: {
    operation: "callback" | "start"
    requestIp: string
  }): Promise<{ reserved: boolean }>
  secureCookies: boolean
  start(input: { requestIpDigest: string }): Promise<{
    authorizationUrl: string
    browserBinding: string
    expiresAt: Date
  }>
}
