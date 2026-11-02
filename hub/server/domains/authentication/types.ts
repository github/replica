export interface PublicIdentityAttributes {
  avatarUrl: string | null
  email: string | null
  login: string
  name: string | null
}

export interface ImmutableIdentityEvidence {
  attributes: PublicIdentityAttributes
  issuer: string
  provider: string
  subject: string
}

export interface AuthenticationProofResult {
  attributes: PublicIdentityAttributes
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
  }): Promise<ImmutableIdentityEvidence>
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
