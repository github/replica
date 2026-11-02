import type { RequestHandler } from "express"

import { hashAuthenticationValue } from "../../../../domains/authentication/hash-authentication-value/index.ts"
import { clearAuthenticationCookie } from "../../../../integrations/express/clear-authentication-cookie/index.ts"
import { readCookie } from "../../../../integrations/express/read-cookie/index.ts"
import { sessionCookieName } from "../callback/index.ts"
import type { SignOutDependencies } from "../types.ts"

export function signOut(dependencies: SignOutDependencies): RequestHandler {
  return async (request, response, next) => {
    const value = readCookie(request, sessionCookieName)
    try {
      if (value) await dependencies.end(hashAuthenticationValue(value))
      response.setHeader(
        "Set-Cookie",
        clearAuthenticationCookie(sessionCookieName, dependencies.secureCookie),
      )
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  }
}
