import { hubSessionCookieName } from "../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../integrations/express/read-cookie/index.ts"
import type { Request } from "express"

import { readProductSession } from "../../product/read-product-session/index.ts"
import type { LearningsRouteDependencies } from "../types.ts"

export function readLearningSession(request: Request, dependencies: LearningsRouteDependencies) {
  return readProductSession(readCookie(request, hubSessionCookieName), dependencies.currentSession)
}
