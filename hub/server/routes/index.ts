import type { Express } from "express"

import { get as handleApiHealthGet } from "./api/health/get/index.ts"

/** Keep endpoint registration separate from the app's shared middleware. */
export function routes(app: Express): void {
  app.get("/api/health", handleApiHealthGet)
}
