import { readHubSessionCookie } from "../../../../integrations/express/read-hub-session-cookie/index.ts"
import type { Request } from "express"

import { readProductSession } from "../../product/read-product-session/index.ts"
import type { LearningsRouteDependencies } from "../types.ts"

export function readLearningSession(request: Request, dependencies: LearningsRouteDependencies) {
  return readProductSession(readHubSessionCookie(request), dependencies.currentSession)
}
