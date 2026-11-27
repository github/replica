import type { RequestHandler } from "express"

import { hashAuthenticationValue } from "../../../../../domains/authentication/hash-authentication-value/index.ts"
import { githubRepositoryDenialCookieName } from "../../../../../integrations/express/github-repository-denial-cookie-name/index.ts"
import { readCookie } from "../../../../../integrations/express/read-cookie/index.ts"
import { readHubSessionCookie } from "../../../../../integrations/express/read-hub-session-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../types.ts"

export function get(
  dependencies: CurrentSessionDependencies,
  reviewInboxAvailable = false,
): RequestHandler {
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
    const value = readHubSessionCookie(request)
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
      response.json({
        authenticated: true,
        membershipId: session.membershipId,
        userId: session.userId,
        provider: session.provider,
        login: session.login,
        name: session.name,
        role: session.role,
        ...(reviewInboxAvailable ? { reviewInboxAvailable: true } : {}),
      })
    } catch (error) {
      next(error)
    }
  }
}
