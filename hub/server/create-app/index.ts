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
  authentication,
  broadcast,
  clientDirectory,
  copilotConnection,
  isReady,
  logger,
  product,
  trustedProxyHops = 0,
}: CreateAppOptions = {}) {
  const app = express()
  app.disable("x-powered-by")
  app.set("trust proxy", trustedProxyHops)
  app.use(createRequestLogger(logger))
  app.use(
    [
      "/api/auth",
      "/api/administrators",
      "/api/copilot-connection",
      "/api/session-revocation",
      "/api/security-audits",
      "/api/workspace",
      "/api/repositories",
    ],
    authenticationSecurity(),
  )
  app.use(
    /^(?!\/api\/copilot-connection(?:\/|$))(?!\/api\/(?:auth|administrators\/authorizations|session-revocation\/authorizations)(?:\/|$))(?!\/api\/repositories\/[^/]+\/prototypes\/[^/]+\/?$).*/i,
    express.json(),
  )

  routes(app, { authentication, broadcast, copilotConnection, isReady, logger, product })
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
      response.setHeader("Cache-Control", "no-cache")
      response.sendFile("index.html", { root: directory, dotfiles: "deny" })
    })
  }
  app.use(respondNotFound)
  app.use(handleError)

  return app
}
