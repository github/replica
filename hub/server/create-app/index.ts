import express from "express"
import type { Logger } from "pino"

import { maximumPublishingJsonBytes } from "../domains/artifact-publishing/create-service/constants.ts"
import { createRateLimit } from "../integrations/express/create-rate-limit/index.ts"
import { handleError } from "../integrations/express/handle-error/index.ts"
import { respondNotFound } from "../integrations/express/respond-not-found/index.ts"
import { createRequestLogger } from "../integrations/pino/create-request-logger/index.ts"
import { omitRequestLogPayload } from "../integrations/pino/omit-request-log-payload/index.ts"
import { routes } from "../routes/index.ts"
import type { AuthenticationRoutes } from "../routes/types.ts"

/** Give every endpoint the same request logging and safe error responses. */
export function createApp({
  authentication,
  logger,
}: { authentication?: AuthenticationRoutes; logger?: Logger } = {}) {
  const app = express()
  app.disable("x-powered-by")
  app.set("trust proxy", authentication?.settings.trustedProxyHops ?? 0)
  app.use(createRequestLogger(logger))
  app.use(
    [
      "/api/auth",
      "/api/session",
      "/api/administration",
      "/api/github/webhooks",
      "/api/workspaces",
      "/api/prototypes",
      "/api/publishing",
    ],
    omitRequestLogPayload,
  )
  app.use("/api/github/webhooks", express.raw({ type: "application/json", limit: "1mb" }))
  app.use(
    "/api/publishing",
    createRateLimit({
      limit: 60,
      windowMilliseconds: 5 * 60_000,
      message: "Too many publishing requests.",
    }),
  )
  app.use(
    "/api/publishing/prototypes/:prototypeId/versions",
    express.json({ limit: maximumPublishingJsonBytes }),
  )
  app.use(express.json())

  routes(app, authentication)
  app.use(respondNotFound)
  app.use(handleError)

  return app
}
