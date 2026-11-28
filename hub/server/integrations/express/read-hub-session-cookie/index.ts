import type { Request } from "express"

import {
  hubSessionCookieName,
  protectedHubSessionCookieSetting,
  secureHubSessionCookieName,
  secureHubSessionCookieSetting,
} from "../hub-session-cookie-name/index.ts"
import { readCookie } from "../read-cookie/index.ts"

export function readHubSessionCookie(
  request: Pick<Request, "headers"> & Partial<Pick<Request, "app">>,
  secure = request.app?.get(secureHubSessionCookieSetting) === true,
  protectedOnly = request.app?.get(protectedHubSessionCookieSetting) === true,
): string | null {
  if (protectedOnly) return readCookie(request, secureHubSessionCookieName)
  return secure
    ? readCookie(request, secureHubSessionCookieName, hubSessionCookieName)
    : readCookie(request, hubSessionCookieName)
}
