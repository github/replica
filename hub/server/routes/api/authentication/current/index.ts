import type { RequestHandler } from "express"

import { clearAuthenticationCookie } from "../../../../integrations/express/clear-authentication-cookie/index.ts"
import { readCookie } from "../../../../integrations/express/read-cookie/index.ts"
import { hashAuthenticationValue } from "../../../../utils/authentication/hash-authentication-value/index.ts"
import { sessionCookieName } from "../callback/index.ts"
import type { AuthenticationRouteRuntime } from "../types.ts"

export function current(runtime: AuthenticationRouteRuntime): RequestHandler {
  return async (request, response, next) => {
    const value = readCookie(request, sessionCookieName)
    if (!value) {
      response.status(401).json({ authenticated: false })
      return
    }
    try {
      const session = await runtime.restore(hashAuthenticationValue(value))
      if (!session) {
        response.setHeader(
          "Set-Cookie",
          clearAuthenticationCookie(sessionCookieName, runtime.secureCookie),
        )
        response.status(401).json({ authenticated: false })
        return
      }
      response.json({
        authenticated: true,
        role: session.role,
      })
    } catch (error) {
      next(error)
    }
  }
}
