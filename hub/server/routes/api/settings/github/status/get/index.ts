import type { RequestHandler } from "express"

import { authorizeGitHubSetup } from "../../authorize-github-setup/index.ts"
import { recheckGitHubSetupAuthority } from "../../recheck-github-setup-authority/index.ts"
import type { GitHubSetupRouteDependencies } from "../../types.ts"

export function get(dependencies: GitHubSetupRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const access = await authorizeGitHubSetup(request, response, dependencies)
      if (!access) return
      const status = await dependencies.readStatus()
      if (!(await recheckGitHubSetupAuthority(request, response, dependencies, access))) return
      response.json(status)
    } catch (error) {
      next(error)
    }
  }
}
