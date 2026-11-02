import type { RequestHandler } from "express"

import { clearAuthenticationCookie } from "../../../../integrations/express/clear-authentication-cookie/index.ts"
import { readCookie } from "../../../../integrations/express/read-cookie/index.ts"
import { hashAuthenticationValue } from "../../../../utils/authentication/hash-authentication-value/index.ts"
import { sessionCookieName } from "../callback/index.ts"
import type { AuthenticationRouteRuntime } from "../types.ts"

export function signOut(runtime: AuthenticationRouteRuntime): RequestHandler {
  return async (request, response, next) => {
    const value = readCookie(request, sessionCookieName)
    try {
      if (value) await runtime.end(hashAuthenticationValue(value))
      response.setHeader(
        "Set-Cookie",
        clearAuthenticationCookie(sessionCookieName, runtime.secureCookie),
      )
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  }
}
