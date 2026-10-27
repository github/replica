import type { Express } from "express"

import { createRateLimit } from "#server/integrations/express/create-rate-limit"
import { prepareAuthenticationRequest } from "#server/integrations/express/prepare-authentication-request"
import { respondAuthenticationError } from "#server/integrations/express/respond-authentication-error"
import { omitRequestLogPayload } from "#server/integrations/pino/omit-request-log-payload"
import { get as handleApiAuthGithubCallbackGet } from "#server/routes/api/auth/github/callback/get"
import { post as handleApiAuthGithubPost } from "#server/routes/api/auth/github/post"
import { get as handleApiHealthGet } from "./api/health/get/index.ts"
import { delete as handleApiSessionDelete } from "#server/routes/api/session/delete"
import { get as handleApiSessionGet } from "#server/routes/api/session/get"
import { post as handleApiSessionRevokeAllPost } from "#server/routes/api/session/revoke-all/post"
import { post as handleApiSessionVerifyPost } from "#server/routes/api/session/verify/post"
import type { AuthenticationRoutes } from "#server/routes/types"

/** Keep endpoint registration separate from the app's shared middleware. */
export function routes(app: Express, authentication?: AuthenticationRoutes): void {
  app.get("/api/health", handleApiHealthGet)
  if (!authentication) return

  app.use(
    ["/api/auth", "/api/session"],
    prepareAuthenticationRequest.bind(null, authentication.settings.origin),
    omitRequestLogPayload,
  )
  const initiationLimit = createRateLimit({
    limit: 20,
    windowMilliseconds: 5 * 60_000,
  })
  const callbackLimit = createRateLimit({
    limit: 60,
    windowMilliseconds: 5 * 60_000,
  })
  app.post("/api/auth/github", initiationLimit, handleApiAuthGithubPost.bind(null, authentication))
  app.get(
    "/api/auth/github/callback",
    callbackLimit,
    handleApiAuthGithubCallbackGet.bind(null, authentication),
  )
  app.get("/api/session", handleApiSessionGet.bind(null, authentication))
  app.delete("/api/session", handleApiSessionDelete.bind(null, authentication))
  app.post(
    "/api/session/verify",
    initiationLimit,
    handleApiSessionVerifyPost.bind(null, authentication),
  )
  app.post("/api/session/revoke-all", handleApiSessionRevokeAllPost.bind(null, authentication))
  app.use(respondAuthenticationError)
}
