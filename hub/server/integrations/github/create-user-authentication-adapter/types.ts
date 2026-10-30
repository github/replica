import type { AuthenticationProviderAdapter } from "../../../domains/authentication/types.ts"

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

export interface GitHubUserAuthenticationAdapter extends AuthenticationProviderAdapter {
  canonicalPublicConfiguration: string
  callbackUri: string
}
