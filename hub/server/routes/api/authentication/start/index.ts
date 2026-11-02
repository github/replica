import type { RequestHandler } from "express"

import { createAuthenticationCookie } from "../../../../integrations/express/create-authentication-cookie/index.ts"
import type { StartAuthenticationDependencies } from "../types.ts"

const browserCookieName = "hub_auth_browser"

export function start(dependencies: StartAuthenticationDependencies): RequestHandler {
  return async (_request, response, next) => {
    try {
      const result = await dependencies.start()
      response.setHeader(
        "Set-Cookie",
        createAuthenticationCookie({
          expiresAt: result.expiresAt,
          name: browserCookieName,
          secure: dependencies.secureCookie,
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
