import type { RequestHandler } from "express"

import { hubSessionCookieName } from "../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../integrations/express/read-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../auth/types.ts"
import { readProductSession } from "../../product/read-product-session/index.ts"
import type { ProductRouteDependencies } from "../../product/types.ts"

export function get(
  session: CurrentSessionDependencies,
  product: ProductRouteDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const cookie = readCookie(request, hubSessionCookieName)
      const initial = await readProductSession(cookie, session)
      if (!initial) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      const repositories = await product.listRepositories(initial)
      const current = await readProductSession(cookie, session)
      if (!current || current.membershipId !== initial.membershipId) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      response.json({
        viewer: {
          id: current.userId,
          login: current.login,
          name: current.name,
          provider: current.provider,
          avatarUrl: null,
        },
        repositories,
        capabilities: {
          createPrototypes: false,
          reviewPrototypes: false,
          manageSharing: false,
          administerHub: current.role === "ADMINISTRATOR",
        },
      })
    } catch (error) {
      next(error)
    }
  }
}
