import express from "express"
import type { Logger } from "pino"

import { handleError } from "../integrations/express/handle-error/index.ts"
import { respondNotFound } from "../integrations/express/respond-not-found/index.ts"
import { createRequestLogger } from "../integrations/pino/create-request-logger/index.ts"
import { routes } from "../routes/index.ts"

/** Give every endpoint the same request logging and safe error responses. */
export function createApp({ logger }: { logger?: Logger } = {}) {
  const app = express()
  app.disable("x-powered-by")
  app.use(createRequestLogger(logger))
  app.use(express.json())

  routes(app)
  app.use(respondNotFound)
  app.use(handleError)

  return app
}
