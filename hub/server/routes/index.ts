import type { Express } from "express"

import type { Broadcast } from "../integrations/ws/types.ts"
import { get as handleApiHealthGet } from "./api/health/get/index.ts"

/** Keep endpoint registration separate from the app's shared middleware. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Product routes will consume these dependencies when ported.
export function routes(app: Express, _dependencies: { broadcast?: Broadcast } = {}): void {
  app.get("/api/health", handleApiHealthGet)
}
