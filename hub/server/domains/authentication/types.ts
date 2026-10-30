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
    attributes: PublicIdentityAttributes
    expiresAt: Date
    handoffToken: string
    status: "authentication_proved"
  }>
  now(): Date
  recordRateLimitDenial(operation: "callback" | "start", primaryError: Error): Promise<void>
  reserveRateLimit(input: { operation: "callback" | "start"; requestIp: string }): Promise<boolean>
  secureCookies: boolean
  start(input: { requestIpDigest: string }): Promise<{
    authorizationUrl: string
    browserBinding: string
    expiresAt: Date
  }>
}
