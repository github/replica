import type { Request } from "express"

import { hashAuthenticationValue } from "../../../../domains/authentication/hash-authentication-value/index.ts"
import { readHubSessionCookie } from "../../../../integrations/express/read-hub-session-cookie/index.ts"

export function readLearningSessionDigest(request: Request): string | null {
  const value = readHubSessionCookie(request)
  return value ? hashAuthenticationValue(value) : null
}
