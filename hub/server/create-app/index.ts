import express from "express"

import { registerRoutes } from "#server/routes"
import type { IdentityService, IdentitySettings } from "#server/utils/identity-contracts/types"
import { respondNotFound } from "#server/utils/respond-not-found"

export function createApp(identity?: { service: IdentityService; settings: IdentitySettings }) {
  const app = express()
  app.disable("x-powered-by")

  registerRoutes(app, identity)
  app.use(respondNotFound)

  return app
}
