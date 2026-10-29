import express from "express"

import { handleError } from "../integrations/express/handle-error/index.ts"
import { respondNotFound } from "../integrations/express/respond-not-found/index.ts"
import { createRequestLogger } from "../integrations/pino/create-request-logger/index.ts"
import { routes } from "../routes/index.ts"

import type { CreateAppOptions } from "./types.ts"

/** Give every endpoint the same request logging and safe error responses. */
export function createApp({ logger, broadcast }: CreateAppOptions = {}) {
  const app = express()
  app.disable("x-powered-by")
  app.use(createRequestLogger(logger))
  app.use(express.json())

  routes(app, { broadcast })
  app.use(respondNotFound)
  app.use(handleError)

  return app
}
