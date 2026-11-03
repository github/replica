import type { RequestHandler } from "express"

import { hashAuthenticationValue } from "../../../../../domains/authentication/hash-authentication-value/index.ts"
import { clearAuthenticationCookie } from "../../../../../integrations/express/clear-authentication-cookie/index.ts"
import { readCookie } from "../../../../../integrations/express/read-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../../authentication/types.ts"
import { sessionCookieName } from "../../github/callback/get/index.ts"

export function get(dependencies: CurrentSessionDependencies): RequestHandler {
  return async (request, response, next) => {
    const value = readCookie(request, sessionCookieName)
    if (!value) {
      response.status(401).json({ authenticated: false })
      return
    }
    try {
      const session = await dependencies.restore(hashAuthenticationValue(value))
      if (!session) {
        response.setHeader(
          "Set-Cookie",
          clearAuthenticationCookie(sessionCookieName, dependencies.secureCookie),
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
