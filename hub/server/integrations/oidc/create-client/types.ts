export interface OidcConfiguration {
  issuer: string
  clientId: string
  clientSecret: string
  clientCredentialReference: string
  callbackUrl: string
  scopes: string[]
  memberRole: string
  administratorRole: string
  membershipPolicy: "jit-assignment" | "invitation-required"
  enabled: boolean
  providerRevision: number
}

export interface OidcProfile {
  subject: string
  directoryObjectId?: string | null
  username: string | null
  email: string | null
  displayName: string | null
  avatarUrl: string | null
  role: "member" | "administrator" | null
}

export interface OidcClient {
  authorizationUrl(
    state: string,
    pkceVerifier: string,
    nonce: string,
    options?: { fresh?: boolean },
  ): Promise<string>
  identify(
    code: string,
    pkceVerifier: string,
    nonce: string,
    options?: { authenticatedAfter?: Date },
  ): Promise<OidcProfile>
}

export interface OidcClientOptions {
  fetch?: typeof fetch
  timeoutMilliseconds?: number
  discoveryCacheMilliseconds?: number
}
