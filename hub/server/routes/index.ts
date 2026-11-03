import type { Express } from "express"

import { get as handleApiHealthGet } from "./api/health/get/index.ts"
import { get as handleApiReadyGet } from "./api/ready/get/index.ts"
import type { RouteDependencies } from "./types.ts"

/** Keep endpoint registration separate from the app's shared middleware. */
export function routes(app: Express, { isReady, logger }: RouteDependencies = {}): void {
  app.get("/api/health", handleApiHealthGet)
  app.get("/api/ready", (request, response) =>
    handleApiReadyGet(request, response, { isReady, logger }),
  )
}
