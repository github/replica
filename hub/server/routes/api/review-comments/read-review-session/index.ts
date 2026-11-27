import type { Request } from "express"

import { hashAuthenticationValue } from "../../../../domains/authentication/hash-authentication-value/index.ts"
import { readHubSessionCookie } from "../../../../integrations/express/read-hub-session-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../auth/types.ts"

export async function readReviewSession(request: Request, session: CurrentSessionDependencies) {
  const cookie = readHubSessionCookie(request)
  if (!cookie) return null
  const sessionDigest = hashAuthenticationValue(cookie)
  const current = await session.restore(sessionDigest)
  return current ? { ...current, sessionDigest } : null
}
