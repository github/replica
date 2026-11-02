import type { RequestHandler } from "express"

import { createAuthenticationCookie } from "../../../../integrations/express/create-authentication-cookie/index.ts"
import type { AuthenticationRouteRuntime, AuthorizationPurpose } from "../types.ts"

const browserCookieName = "hub_auth_browser"

export function start(
  runtime: AuthenticationRouteRuntime,
  purpose: AuthorizationPurpose,
): RequestHandler {
  return async (_request, response, next) => {
    try {
      const result = await runtime.start(purpose)
      response.setHeader(
        "Set-Cookie",
        createAuthenticationCookie({
          expiresAt: result.expiresAt,
          name: browserCookieName,
          secure: runtime.secureCookie,
          value: result.browserBinding,
        }),
      )
      response.redirect(303, result.authorizationUrl)
    } catch (error) {
      next(error)
    }
  }
}

export { browserCookieName }
