import type { RequestHandler } from "express"

import type { GitHubActionsRouteDependencies } from "../types.ts"

/** Verifies the workflow's OIDC token before any upload body is read. */
export function authenticate(dependencies: GitHubActionsRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const [scheme, token] = (request.get("authorization") ?? "").split(" ")
      const result =
        scheme === "Bearer" && token
          ? await dependencies.verifyToken(token)
          : { status: "invalid" as const }
      if (result.status === "invalid") {
        response.status(401).json({
          error: "invalid_token",
          message: "The GitHub Actions identity token is missing, expired, or not for this Hub.",
        })
        return
      }
      if (result.status === "forbidden") {
        response.status(403).json({ error: "forbidden", message: result.reason })
        return
      }
      response.locals.run = result.run
      next()
    } catch (error) {
      next(error)
    }
  }
}
