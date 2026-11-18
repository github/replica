import type { RequestHandler } from "express"

import { hubSessionCookieName } from "../../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../../integrations/express/read-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../../auth/types.ts"
import { readProductSession } from "../../../product/read-product-session/index.ts"
import type { PublicSharingRouteDependencies } from "../../types.ts"

export function get(
  session: CurrentSessionDependencies,
  sharing: PublicSharingRouteDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const current = await readProductSession(readCookie(request, hubSessionCookieName), session)
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
