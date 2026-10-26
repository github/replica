import express from "express"
import type { NextFunction, Request, Response } from "express"
import type { Logger } from "pino"

import { createRequestLogger } from "../integrations/pino/create-request-logger/index.ts"

export function createApp({ logger }: { logger?: Logger } = {}) {
  const app = express()
  app.disable("x-powered-by")
  app.use(createRequestLogger(logger))
  app.use(express.json())

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" })
  })

  app.use((_request, response) => {
    response.status(404).json({ error: "Not found" })
  })

  // Express identifies error handlers by their four-argument signature.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function handleError(error: unknown, _request: Request, response: Response, _next: NextFunction) {
    if (response.headersSent) {
      response.destroy()
      return
    }
    const status =
      error !== null &&
      typeof error === "object" &&
      "status" in error &&
      typeof error.status === "number" &&
      Number.isInteger(error.status) &&
      error.status >= 400 &&
      error.status <= 599
        ? error.status
        : 500
    response.status(status).json({
      error: status >= 500 ? "Internal server error" : "Invalid request",
    })
  }
  app.use(handleError)

  return app
}
