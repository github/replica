import type { Request } from "express"

import { hubSessionCookieName } from "../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../integrations/express/read-cookie/index.ts"
import { readProductSession } from "../../product/read-product-session/index.ts"
import type { DecisionModelRouteDependencies } from "../types.ts"

export function readDecisionModelSession(
  request: Request,
  dependencies: DecisionModelRouteDependencies,
) {
  return readProductSession(readCookie(request, hubSessionCookieName), dependencies.currentSession)
}
