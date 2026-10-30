import type { RequestHandler } from "express"

import { AuthenticationProofError } from "../../../../../../domains/authentication/errors.ts"
import type { GitHubAuthenticationRoutesDependencies } from "../../types.ts"

const BROWSER_COOKIE = "hub_auth_browser"

export function post(dependencies: GitHubAuthenticationRoutesDependencies): RequestHandler {
  return async (request, response) => {
    response.set("Cache-Control", "no-store")
    response.locals.omitLogPayload = true
    if (request.get("origin") !== dependencies.appOrigin) {
      response.status(403).json({ error: "Authentication request origin is not allowed." })
      return
    }
    try {
      const result = await dependencies.start({
        requestIp: request.ip ?? request.socket.remoteAddress ?? "unavailable",
      })
      response.cookie(BROWSER_COOKIE, result.browserBinding, {
        httpOnly: true,
        sameSite: "lax",
        secure: dependencies.secureCookies,
        path: "/api/auth",
        expires: result.expiresAt,
      })
      response.redirect(303, result.authorizationUrl)
    } catch (error) {
      if (error instanceof AuthenticationProofError) {
        response.status(error.code === "rate_limited" ? 429 : 503).json({ error: error.message })
        return
      }
      throw error
    }
  }
}
