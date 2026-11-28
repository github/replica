import type { Request } from "express"

import {
  hubSessionCookieName,
  secureHubSessionCookieName,
  secureHubSessionCookieSetting,
} from "../hub-session-cookie-name/index.ts"
import { readCookie } from "../read-cookie/index.ts"

// On HTTPS, another host on Hub's site can set the unprefixed name, so only __Host- counts.
export function readHubSessionCookie(
  request: Pick<Request, "headers"> & Partial<Pick<Request, "app">>,
  secure = request.app?.get(secureHubSessionCookieSetting) === true,
): string | null {
  return readCookie(request, secure ? secureHubSessionCookieName : hubSessionCookieName)
}
