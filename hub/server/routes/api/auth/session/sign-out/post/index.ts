import type { RequestHandler } from "express"

import { SessionTerminationConflictError } from "../../../../../../domains/admission/errors.ts"
import { hashAuthenticationValue } from "../../../../../../domains/authentication/hash-authentication-value/index.ts"
import { clearHubSessionCookies } from "../../../../../../integrations/express/clear-hub-session-cookies/index.ts"
import { readHubSessionCookie } from "../../../../../../integrations/express/read-hub-session-cookie/index.ts"
import type { SignOutDependencies } from "../../../types.ts"

export function post(dependencies: SignOutDependencies): RequestHandler {
  return async (request, response, next) => {
    const value = readHubSessionCookie(request)
    try {
      if (value) await dependencies.end(hashAuthenticationValue(value))
      response.setHeader("Set-Cookie", clearHubSessionCookies(dependencies.secureCookie))
      if ((request.get("accept") ?? "").includes("text/html")) {
        response.redirect(303, "/")
        return
      }
      response.status(204).end()
    } catch (error) {
      if (error instanceof SessionTerminationConflictError) {
        response.setHeader("Retry-After", "1")
        if ((request.get("accept") ?? "").includes("text/html")) {
          response
            .status(503)
            .type("text/plain")
            .send("Sign-out is temporarily unavailable. Return to Replica Hub and try again.")
          return
        }
        response.status(503).json({ error: "Sign-out is temporarily unavailable. Try again." })
        return
      }
      next(error)
    }
  }
}
