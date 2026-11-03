import express from "express"
import { resolve } from "node:path"

import { handleError } from "../integrations/express/handle-error/index.ts"
import { respondNotFound } from "../integrations/express/respond-not-found/index.ts"
import { createRequestLogger } from "../integrations/pino/create-request-logger/index.ts"
import { routes } from "../routes/index.ts"

import type { CreateAppOptions } from "./types.ts"

/** Give every endpoint the same request logging and safe error responses. */
export function createApp({ broadcast, logger, clientDirectory, isReady }: CreateAppOptions = {}) {
  const app = express()
  app.disable("x-powered-by")
  app.use(createRequestLogger(logger))
  app.use(express.json())

  routes(app, { broadcast, isReady, logger })
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
      response.sendFile(resolve(directory, "index.html"))
    })
  }
  app.use(respondNotFound)
  app.use(handleError)

  return app
}
