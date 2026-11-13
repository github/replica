import type { Request } from "express"

import { hubSessionCookieName } from "../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../integrations/express/read-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../auth/types.ts"
import { readProductSession } from "../../product/read-product-session/index.ts"

export function readReviewSession(request: Request, session: CurrentSessionDependencies) {
  return readProductSession(readCookie(request, hubSessionCookieName), session)
}
