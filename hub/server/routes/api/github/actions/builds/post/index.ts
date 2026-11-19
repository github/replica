import type { RequestHandler } from "express"

import type { GitHubActionsLocals, GitHubActionsRouteDependencies } from "../../types.ts"

/** Imports a dist package pushed by a verified Replica workflow run. */
export function post(
  dependencies: GitHubActionsRouteDependencies,
): RequestHandler<unknown, unknown, unknown, unknown, GitHubActionsLocals> {
  return async (request, response, next) => {
    try {
      if (!Buffer.isBuffer(request.body)) {
        response.status(415).json({ error: "unsupported_media_type" })
        return
      }
      const result = await dependencies.receiveBuild(response.locals.run, request.body)
      switch (result.status) {
        case "imported":
        case "unchanged":
          response
            .status(result.status === "imported" ? 201 : 200)
            .json({ status: result.status, buildId: result.buildId })
          return
        case "failed":
          response.status(422).json({ error: "invalid_package", message: result.reason })
          return
        case "unknown-repository":
          response.status(404).json({
            error: "unknown_repository",
            message: "This repository is not connected to the Hub.",
          })
          return
        case "rejected":
          response.status(409).json({ error: "conflict", message: result.reason })
          return
        case "unavailable":
          response.status(503).json({
            error: "unavailable",
            message: "The Hub could not read this workflow run from GitHub.",
          })
          return
      }
    } catch (error) {
      next(error)
    }
  }
}
