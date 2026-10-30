export interface GitHubAuthenticationPublicConfiguration {
  authorizationEndpoint: string
  callbackUri: string
  clientId: string
  tokenEndpoint: string
  userEndpoint: string
}

export interface CreateGitHubUserAuthenticationAdapterInput {
  clientSecret: string
  fetch?: typeof globalThis.fetch
  publicConfiguration: unknown
}

export interface GitHubUserIdentityEvidence {
  attributes: {
    avatarUrl: string | null
    email: string | null
    login: string
    name: string | null
  }
  issuer: string
  provider: string
  subject: string
}

export interface GitHubUserAuthenticationAdapter {
  canonicalPublicConfiguration: string
  callbackUri: string
  providerKey: string
  createAuthorizationUrl(input: { callbackUri: string; codeChallenge: string; state: string }): URL
  completeAuthenticationProof(input: {
    callbackUri: string
    code: string
    codeVerifier: string
  }): Promise<GitHubUserIdentityEvidence>
}
