import type { RequestHandler } from "express"

import { hashAuthenticationValue } from "../../../../../domains/authentication/hash-authentication-value/index.ts"
import { githubRepositoryDenialCookieName } from "../../../../../integrations/express/github-repository-denial-cookie-name/index.ts"
import { hubSessionCookieName } from "../../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../../integrations/express/read-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../types.ts"

export function get(dependencies: CurrentSessionDependencies): RequestHandler {
  return async (request, response, next) => {
    if (request.query.explain_no_repository_access === "1") {
      const notice = readCookie(request, githubRepositoryDenialCookieName)
      const denial = notice && dependencies.readGitHubRepositoryDenialNotice?.(notice)
      if (denial) {
        response.status(401).json({
          authenticated: false,
          login: denial.login,
          reason: "no_repository_access",
        })
        return
      }
    }
    const value = readCookie(request, hubSessionCookieName)
    if (!value) {
      response.status(401).json({ authenticated: false })
      return
    }
    try {
      const digest = hashAuthenticationValue(value)
      const session = await dependencies.restore(digest)
      if (!session) {
        const denial = await dependencies.findGitHubRepositoryAccessDenial?.(digest)
        if (denial) {
          response.status(401).json({
            authenticated: false,
            error: "Your GitHub account no longer has access to a connected repository.",
            login: denial.login,
            reason: "no_repository_access",
          })
          return
        }
        response.status(401).json({ authenticated: false })
        return
      }
      response.json({ authenticated: true, ...session })
    } catch (error) {
      next(error)
    }
  }
}
