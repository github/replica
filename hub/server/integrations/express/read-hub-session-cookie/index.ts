import type { Request } from "express"

import {
  hubSessionCookieName,
  secureHubSessionCookieName,
} from "../hub-session-cookie-name/index.ts"
import { readCookie } from "../read-cookie/index.ts"

export function readHubSessionCookie(request: Pick<Request, "headers">): string | null {
  return readCookie(request, secureHubSessionCookieName, hubSessionCookieName)
}
