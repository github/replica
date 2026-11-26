import express from "express"
import { resolve } from "node:path"

import { authenticationSecurity } from "../integrations/express/authentication-security/index.ts"
import { handleError } from "../integrations/express/handle-error/index.ts"
import { respondNotFound } from "../integrations/express/respond-not-found/index.ts"
import { createRequestLogger } from "../integrations/pino/create-request-logger/index.ts"
import { routes } from "../routes/index.ts"

import type { CreateAppOptions } from "./types.ts"

/** Give every endpoint the same request logging and safe error responses. */
export function createApp({
  agentConnections,
  agentVisualCritic,
  authentication,
  broadcast,
  githubSetup,
  githubWebhooks,
  clientDirectory,
  copilotConnection,
  decisionModels,
  isReady,
  learnings,
  logger,
  preview,
  privatePreview,
  product,
  publicSharing,
  trustedProxyHops = 0,
}: CreateAppOptions = {}) {
  const app = express()
  app.disable("x-powered-by")
  app.set("trust proxy", trustedProxyHops)
  app.use(createRequestLogger(logger))
  app.use(
    [
      "/api/canvas",
      "/api/agent-connections",
      "/api/auth",
      "/canvas/pair",
      "/agents/approve",
      // Agent OAuth and MCP calls carry tokens, codes, and private tool arguments.
      "/mcp",
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource",
      "/register",
      "/authorize",
      "/token",
      "/revoke",
      "/api/administrators",
      "/api/copilot-connection",
      "/api/session-revocation",
      "/api/security-audits",
      "/api/workspace",
      "/api/notifications",
      "/api/repositories",
      "/api/shared",
      "/__replica/authorize",
      "/__replica/share/authorize",
      "/api/settings",
    ],
    authenticationSecurity(),
  )
  app.use(
    /^(?!\/api\/(?:copilot-connection|notifications|private-preview)(?:\/|$))(?!\/api\/product\/sharing-settings(?:\/|$))(?!\/api\/repositories\/[^/]+\/(?:learnings|decision-model|analytics|prototype-management)(?:\/|$))(?!\/api\/(?:auth|canvas|administrators\/authorizations|session-revocation\/authorizations|github\/webhooks)(?:\/|$))(?!\/api\/repositories\/[^/]+\/prototypes\/[^/]+(?:\/review-comments(?:\/|$)|\/share-links(?:\/|$)|\/?$)).*/i,
    express.json(),
  )

  routes(app, {
    agentConnections,
    agentVisualCritic,
    authentication,
    broadcast,
    copilotConnection,
    decisionModels,
    githubSetup,
    githubWebhooks,
    isReady,
    learnings,
    logger,
    preview,
    privatePreview,
    product,
    publicSharing,
  })
  app.use("/api", respondNotFound)
  if (clientDirectory) {
    const directory = resolve(clientDirectory)
    app.use(express.static(directory, { dotfiles: "deny", index: false, redirect: false }))
    app.get("/{*path}", (request, response, next) => {
      const acceptsHtml = request
        .get("accept")
        ?.split(",")
        .some((type) => type.split(";")[0]?.trim() === "text/html")
      if (
        !acceptsHtml ||
        !request.accepts("html") ||
        request.path.split("/").some((part) => part.includes("."))
      ) {
        next()
        return
      }
      if (!response.hasHeader("Cache-Control")) response.setHeader("Cache-Control", "no-cache")
      response.sendFile("index.html", { root: directory, dotfiles: "deny" })
    })
  }
  app.use(respondNotFound)
  app.use(handleError)

  return app
}
