import { clearAuthenticationCookie } from "../clear-authentication-cookie/index.ts"
import {
  hubSessionCookieName,
  secureHubSessionCookieName,
} from "../hub-session-cookie-name/index.ts"

export function clearHubSessionCookies(secure: boolean): string[] {
  return [
    clearAuthenticationCookie(hubSessionCookieName, secure),
    ...(secure ? [clearAuthenticationCookie(secureHubSessionCookieName, true)] : []),
  ]
}
