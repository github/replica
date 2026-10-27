import express from "express"
import type { Logger } from "pino"

import { handleError } from "../integrations/express/handle-error/index.ts"
import { respondNotFound } from "../integrations/express/respond-not-found/index.ts"
import { createRequestLogger } from "../integrations/pino/create-request-logger/index.ts"
import { routes } from "../routes/index.ts"
import type { AuthenticationRoutes } from "../routes/types.ts"

/** Give every endpoint the same request logging and safe error responses. */
export function createApp({
  authentication,
  logger,
}: { authentication?: AuthenticationRoutes; logger?: Logger } = {}) {
  const app = express()
  app.disable("x-powered-by")
  app.use(createRequestLogger(logger))
  app.use(express.json())

  routes(app, authentication)
  app.use(respondNotFound)
  app.use(handleError)

  return app
}
