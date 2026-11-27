import type { RequestHandler } from "express"

import { readHubSessionCookie } from "../../../../../integrations/express/read-hub-session-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../../auth/types.ts"
import { readProductSession } from "../../../product/read-product-session/index.ts"
import type { PublicSharingRouteDependencies } from "../../types.ts"

export function get(
  session: CurrentSessionDependencies,
  sharing: PublicSharingRouteDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const current = await readProductSession(readHubSessionCookie(request), session)
      if (!current) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      if (current.role !== "ADMINISTRATOR") {
        response.json({ enabled: false, canAdminister: false, activeLinkCount: 0 })
        return
      }
      const settings = await sharing.getSettings()
      response.json({
        enabled: settings.enabled,
        canAdminister: true,
        activeLinkCount: settings.activeLinkCount,
      })
    } catch (error) {
      next(error)
    }
  }
}
