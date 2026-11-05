import type { Response } from "express"

import { browserAuthenticationCookieName } from "../browser-authentication-cookie-name/index.ts"
import { createAuthenticationCookie } from "../create-authentication-cookie/index.ts"

export function redirectAuthenticationStart(
  response: Response,
  secureCookie: boolean,
  result: {
    authorizationUrl: string
    browserBinding: string
    expiresAt: Date
  },
): void {
  response.setHeader(
    "Set-Cookie",
    createAuthenticationCookie({
      expiresAt: result.expiresAt,
      name: browserAuthenticationCookieName,
      secure: secureCookie,
      value: result.browserBinding,
    }),
  )
  response.redirect(303, result.authorizationUrl)
}
