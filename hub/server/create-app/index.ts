import express from "express"

import { installIdentityRoutes } from "../identity-routes/index.ts"
import type { IdentityService, IdentitySettings } from "../utils/identity-contracts/types.ts"

export function createApp(identity?: { service: IdentityService; settings: IdentitySettings }) {
  const app = express()
  app.disable("x-powered-by")

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" })
  })

  if (identity) installIdentityRoutes(app, identity.service, identity.settings)

  app.use((_request, response) => {
    response.status(404).json({ error: "Not found" })
  })

  return app
}
