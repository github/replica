import express from "express"

import { respondNotFound } from "#server/integrations/express/respond-not-found"
import { routes } from "#server/routes"
import type { IdentityService, IdentitySettings } from "#server/utils/identity-contracts/types"

export function createApp(identity?: { service: IdentityService; settings: IdentitySettings }) {
  const app = express()
  app.disable("x-powered-by")

  routes(app, identity)
  app.use(respondNotFound)

  return app
}
