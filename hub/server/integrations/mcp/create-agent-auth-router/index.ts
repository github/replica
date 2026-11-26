import type { RequestHandler } from "express"
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js"

import { agentOAuthProvider } from "../agent-oauth-provider/index.ts"
import type { AgentOAuthService } from "../agent-oauth-provider/types.ts"

export const agentMcpPath = "/mcp"

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
