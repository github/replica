import type { Request } from "express"

import { hashAuthenticationValue } from "../../../../domains/authentication/hash-authentication-value/index.ts"
import { hubSessionCookieName } from "../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../integrations/express/read-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../auth/types.ts"

export async function readReviewSession(request: Request, session: CurrentSessionDependencies) {
  const cookie = readCookie(request, hubSessionCookieName)
  if (!cookie) return null
  const sessionDigest = hashAuthenticationValue(cookie)
  const current = await session.restore(sessionDigest)
  return current ? { ...current, sessionDigest } : null
}
