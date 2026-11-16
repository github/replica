import type { RequestHandler } from "express"

import { authorizeGitHubSetup } from "../../authorize-github-setup/index.ts"
import type { GitHubSetupRouteDependencies } from "../../types.ts"

export function get(dependencies: GitHubSetupRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      if (!(await authorizeGitHubSetup(request, response, dependencies))) return
      response.json(await dependencies.readStatus())
    } catch (error) {
      next(error)
    }
  }
}
