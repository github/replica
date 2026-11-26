import type { RequestHandler } from "express"
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js"
import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js"

import {
  agentMcpPath,
  agentOAuthProvider,
  type AgentOAuthService,
} from "../create-agent-auth-router/index.ts"

/**
 * Rejects requests without a live agent token. The response points agents at Hub's OAuth
 * metadata, which is how they learn to start sign-in.
 */
export function requireAgentToken(
  applicationOrigin: string,
  service: AgentOAuthService,
): RequestHandler {
  return requireBearerAuth({
    verifier: agentOAuthProvider(service),
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(
      new URL(agentMcpPath, applicationOrigin),
    ),
  })
}
