import type { GitHubRepositoryEvidence } from "../types.ts"

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
  /** Enables repository-access admission for members of this App installation. */
  installationId?: number
  publicConfiguration: unknown
}

export interface GitHubUserIdentityEvidence {
  issuer: string
  provider: string
  subject: string
}

export interface GitHubUserAuthenticationAdapter {
  canonicalPublicConfiguration: string
  callbackUri: string
  providerKey: string
  createAuthorizationUrl(input: {
    callbackUri: string
    codeChallenge: string
    freshAuthentication: boolean
    nonce: string
    state: string
  }): URL
  completeAuthenticationProof(input: {
    authenticatedAfter?: Date
    callbackUri: string
    code: string
    codeVerifier: string
    nonce: string
  }): Promise<{
    identity: GitHubUserIdentityEvidence
    providerAssignment?: {
      assignmentSubject: string
      issuedAt: Date
      role: "MEMBER" | null
    }
    repositoryAccess?: GitHubRepositoryEvidence[]
  }>
}
