import type { RequestHandler } from "express"

import type { GitHubActionsLocals, GitHubActionsRouteDependencies } from "../../types.ts"

/** Attaches screenshots pushed by a verified Replica workflow run to its Build. */
export function post(
  dependencies: GitHubActionsRouteDependencies,
): RequestHandler<unknown, unknown, unknown, unknown, GitHubActionsLocals> {
  return async (request, response, next) => {
    try {
      if (!Buffer.isBuffer(request.body)) {
        response.status(415).json({ error: "unsupported_media_type" })
        return
      }
      const result = await dependencies.receiveScreenshots(response.locals.run, request.body)
      switch (result.status) {
        case "attached":
          response.status(200).json({ status: "attached" })
          return
        case "invalid":
          response.status(422).json({ error: "invalid_package", message: result.reason })
          return
        case "not-ready":
          response.status(409).json({
            error: "build_not_ready",
            message: "This commit has no successful Build yet. Publish its dist first.",
          })
          return
        case "digest-mismatch":
          response.status(409).json({
            error: "digest_mismatch",
            message: "These screenshots were captured from a different dist than the Build.",
          })
          return
      }
    } catch (error) {
      next(error)
    }
  }
}
