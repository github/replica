import type { RequestHandler } from "express"

import { hashAuthenticationValue } from "../../../../../domains/authentication/hash-authentication-value/index.ts"
import { hubSessionCookieName } from "../../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../../integrations/express/read-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../../auth/types.ts"
import { readProductSession } from "../../../product/read-product-session/index.ts"
import type { WorkspaceProductRouteDependencies } from "../../../product/types.ts"

export function patch(
  session: CurrentSessionDependencies,
  welcome: NonNullable<WorkspaceProductRouteDependencies["welcome"]>,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const cookie = readCookie(request, hubSessionCookieName)
      const current = await readProductSession(cookie, session)
      if (
        !cookie ||
        !current ||
        !(await welcome.hide(hashAuthenticationValue(cookie), current.userId))
      ) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      response.json({ welcomeHidden: true })
    } catch (error) {
      next(error)
    }
  }
}
