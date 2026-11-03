import type { RequestHandler } from "express"

import { hashAuthenticationValue } from "../../../../../domains/authentication/hash-authentication-value/index.ts"
import { hubSessionCookieName } from "../../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../../integrations/express/read-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../types.ts"

export function get(dependencies: CurrentSessionDependencies): RequestHandler {
  return async (request, response, next) => {
    const value = readCookie(request, hubSessionCookieName)
    if (!value) {
      response.status(401).json({ authenticated: false })
      return
    }
    try {
      const authenticated = await dependencies.restore(hashAuthenticationValue(value))
      if (!authenticated) {
        response.status(401).json({ authenticated: false })
        return
      }
      response.json({ authenticated: true })
    } catch (error) {
      next(error)
    }
  }
}
