import type { Request } from "express"

import { hashAuthenticationValue } from "../../../../domains/authentication/hash-authentication-value/index.ts"
import { hubSessionCookieName } from "../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../integrations/express/read-cookie/index.ts"

export function readSessionDigest(request: Request) {
  const value = readCookie(request, hubSessionCookieName)
  return value ? hashAuthenticationValue(value) : null
}
