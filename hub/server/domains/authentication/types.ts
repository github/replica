export interface ImmutableIdentityEvidence {
  issuer: string
  provider: string
  subject: string
}

export interface ProviderAssignmentEvidence {
  assignmentSubject: string | null
  issuedAt: Date
  role: "MEMBER" | "ADMINISTRATOR" | null
}

export interface AuthenticationCompletionEvidence {
  identity: ImmutableIdentityEvidence
  profile?: {
    login: string
    name: string | null
  }
  providerAssignment?: ProviderAssignmentEvidence
  /** GitHub repositories the person can read through the connected App installation. */
  repositoryAccess?: Array<{
    defaultBranch: string
    githubRepositoryId: number
    nameWithOwner: string
  }>
}

/**
 * Internal proof reference. It is not request input, a session, or authority.
 * A trusted consumer rereads both referenced authoritative records before using it.
 */
export interface AuthenticationProofResult {
  authorizationAttemptId: string
  externalIdentityId: string
}

export interface AuthenticationProviderAdapter {
  readonly providerKey: string
  createAuthorizationUrl(input: {
    callbackUri: string
    codeChallenge: string
    freshAuthentication: boolean
    nonce: string
    state: string
  }): URL | Promise<URL>
  completeAuthenticationProof(input: {
    authenticatedAfter?: Date
    callbackUri: string
    code: string
    codeVerifier: string
    nonce: string
  }): Promise<AuthenticationCompletionEvidence>
}
