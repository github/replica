import type { Request } from "express"

import { readHubSessionCookie } from "../../../../integrations/express/read-hub-session-cookie/index.ts"
import { readProductSession } from "../../product/read-product-session/index.ts"
import type { DecisionModelRouteDependencies } from "../types.ts"

export function readDecisionModelSession(
  request: Request,
  dependencies: DecisionModelRouteDependencies,
) {
  return readProductSession(readHubSessionCookie(request), dependencies.currentSession)
}
