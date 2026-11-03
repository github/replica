import type { RequestHandler } from "express"

import { browserAuthenticationCookieName } from "../browser-authentication-cookie-name/index.ts"
import { createAuthenticationCookie } from "../create-authentication-cookie/index.ts"

interface StartAuthenticationDependencies {
  secureCookie: boolean
  start(): Promise<{
    authorizationUrl: string
    browserBinding: string
    expiresAt: Date
  }>
}

export function startAuthentication(dependencies: StartAuthenticationDependencies): RequestHandler {
  return async (_request, response, next) => {
    try {
      const result = await dependencies.start()
      response.setHeader(
        "Set-Cookie",
        createAuthenticationCookie({
          expiresAt: result.expiresAt,
          name: browserAuthenticationCookieName,
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
