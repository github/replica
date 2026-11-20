import type { Response } from "express"

import { browserAuthenticationCookieName } from "../browser-authentication-cookie-name/index.ts"
import { bindCanvasSignInReturn, canvasSignInReturnCookie } from "../canvas-sign-in-return/index.ts"
import { clearAuthenticationCookie } from "../clear-authentication-cookie/index.ts"
import { createAuthenticationCookie } from "../create-authentication-cookie/index.ts"
import { githubRepositoryDenialCookieName } from "../github-repository-denial-cookie-name/index.ts"

export function redirectAuthenticationStart(
  response: Response,
  secureCookie: boolean,
  result: {
    authorizationUrl: string
    browserBinding: string
    expiresAt: Date
  },
  canvasReturnTo?: string,
): void {
  response.setHeader("Set-Cookie", [
    createAuthenticationCookie({
      expiresAt: result.expiresAt,
      name: browserAuthenticationCookieName,
      secure: secureCookie,
      value: result.browserBinding,
    }),
    clearAuthenticationCookie(githubRepositoryDenialCookieName, secureCookie),
    ...(canvasReturnTo
      ? [
          createAuthenticationCookie({
            expiresAt: result.expiresAt,
            name: canvasSignInReturnCookie,
            secure: secureCookie,
            value: bindCanvasSignInReturn(result.browserBinding, canvasReturnTo),
          }),
        ]
      : []),
  ])
  response.redirect(303, result.authorizationUrl)
}
