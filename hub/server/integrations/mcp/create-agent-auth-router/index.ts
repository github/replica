import type { RequestHandler } from "express"
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js"
import {
  InvalidGrantError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js"
import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js"
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

export const agentMcpPath = "/mcp"

function clientInformation(client: { id: string; name: string; redirectUris: string[] }) {
  return {
    client_id: client.id,
    client_name: client.name,
    redirect_uris: client.redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }
}

/** Adapts Hub's agent connections to the SDK's OAuth provider contract. */
export function agentOAuthProvider(service: AgentOAuthService): OAuthServerProvider {
  return {
    clientsStore: {
      getClient: async (id) => {
        if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined
        const client = await service.getClient(id)
        return client ? clientInformation(client) : undefined
      },
      // Agents run on people's machines and cannot keep a secret, so every client is
      // public and relies on PKCE.
      registerClient: async (metadata) => {
        const client = {
          id: (metadata as { client_id?: string }).client_id ?? crypto.randomUUID(),
          name: (metadata.client_name ?? "Coding agent").slice(0, 200),
          redirectUris: metadata.redirect_uris.map(String),
        }
        await service.registerClient(client)
        return {
          ...clientInformation(client),
          client_id_issued_at: Math.floor(Date.now() / 1000),
        }
      },
    },
    async authorize(client, params, response) {
      const id = await service.startAuthorization({
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        ...(params.state === undefined ? {} : { state: params.state }),
      })
      response.redirect(302, `/agents/approve/${id}`)
    },
    async challengeForAuthorizationCode(client, code) {
      const challenge = await service.challenge(client.client_id, code)
      if (!challenge) throw new InvalidGrantError("The authorization code is invalid or expired.")
      return challenge
    },
    async exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
      const tokens = await service.exchangeCode(client.client_id, code, redirectUri)
      if (!tokens) throw new InvalidGrantError("The authorization code is invalid or expired.")
      return tokens
    },
    async exchangeRefreshToken(client, refreshToken) {
      const tokens = await service.refresh(client.client_id, refreshToken)
      if (!tokens) throw new InvalidGrantError("The refresh token is invalid or expired.")
      return tokens
    },
    async verifyAccessToken(token) {
      const result = await service.verify(token)
      if (!result) throw new InvalidTokenError("The access token is invalid or expired.")
      const { connection } = result
      return {
        token,
        clientId: connection.clientId,
        scopes: [],
        expiresAt: Math.floor(connection.expiresAt.getTime() / 1000),
        extra: { result },
      }
    },
    async revokeToken(client, request) {
      await service.revokeToken(client.client_id, request.token)
    },
  }
}

/**
 * Serves OAuth discovery, client registration, sign-in and token endpoints, so agents
 * that support MCP authorization can connect with only Hub's MCP URL.
 */
export function createAgentAuthRouter(
  applicationOrigin: string,
  service: AgentOAuthService,
): RequestHandler {
  return mcpAuthRouter({
    provider: agentOAuthProvider(service),
    issuerUrl: new URL(applicationOrigin),
    resourceServerUrl: new URL(agentMcpPath, applicationOrigin),
    resourceName: "Replica Hub learnings",
  })
}
