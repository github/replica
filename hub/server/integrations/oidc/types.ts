export interface OidcClientAuthenticationProvider {
  canonicalPublicConfiguration: Record<string, string>
  createTokenRequestFields(): Promise<Record<string, string>>
}
