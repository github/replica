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
