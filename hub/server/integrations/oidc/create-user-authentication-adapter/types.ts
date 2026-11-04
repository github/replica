import type { OidcClientAuthenticationProvider } from "../types.ts"

export interface EntraOidcPublicConfiguration {
  callbackUri: string
  clientId: string
  issuer: string
  scopes: string[]
}

export interface CreateEntraOidcUserAuthenticationAdapterInput {
  clientAuthentication: OidcClientAuthenticationProvider
  fetch?: typeof globalThis.fetch
  publicConfiguration: unknown
}

export interface EntraOidcUserAuthenticationAdapter {
  canonicalPublicConfiguration: string
  callbackUri: string
  completeAuthenticationProof(input: {
    authenticatedAfter?: Date
    callbackUri: string
    code: string
    codeVerifier: string
    nonce: string
  }): Promise<{
    identity: {
      issuer: string
      provider: string
      subject: string
    }
    providerAssignment: {
      assignmentSubject: string | null
      role: "MEMBER" | "ADMINISTRATOR" | null
    }
  }>
  createAuthorizationUrl(input: {
    callbackUri: string
    codeChallenge: string
    freshAuthentication: boolean
    nonce: string
    state: string
  }): Promise<URL>
  providerKey: string
  validateConfiguration(): Promise<void>
}
