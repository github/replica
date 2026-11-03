import type { RequestHandler } from "express"

import { hashAuthenticationValue } from "../../../../../../domains/authentication/hash-authentication-value/index.ts"
import { clearAuthenticationCookie } from "../../../../../../integrations/express/clear-authentication-cookie/index.ts"
import { readCookie } from "../../../../../../integrations/express/read-cookie/index.ts"
import type { SignOutDependencies } from "../../../../authentication/types.ts"
import { sessionCookieName } from "../../../github/callback/get/index.ts"

export function post(dependencies: SignOutDependencies): RequestHandler {
  return async (request, response, next) => {
    const value = readCookie(request, sessionCookieName)
    try {
      if (value) await dependencies.end(hashAuthenticationValue(value))
      response.setHeader(
        "Set-Cookie",
        clearAuthenticationCookie(sessionCookieName, dependencies.secureCookie),
      )
      if ((request.get("accept") ?? "").includes("text/html")) {
        response.redirect(303, "/")
        return
      }
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  }
}
