import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js"

export interface AgentOAuthService {
  registerClient(client: { id: string; name: string; redirectUris: string[] }): Promise<unknown>
  getClient(id: string): Promise<{ id: string; name: string; redirectUris: string[] } | null>
  startAuthorization(input: {
    clientId: string
    redirectUri: string
    codeChallenge: string
    state?: string
  }): Promise<string>
  challenge(clientId: string, code: string): Promise<string | null>
  exchangeCode(clientId: string, code: string, redirectUri?: string): Promise<OAuthTokens | null>
  refresh(clientId: string, refreshToken: string): Promise<OAuthTokens | null>
  verify(accessToken: string): Promise<{
    connection: { id: string; clientId: string; expiresAt: Date }
  } | null>
  revokeToken(clientId: string, token: string): Promise<void>
}
