import type { Request, Response } from "express"

import type { AuthenticationRoutes } from "#server/routes/types"
import { authenticationCookies } from "#server/utils/authentication-cookies"
import { readCookie } from "#server/utils/read-cookie"
import { requireCsrfToken } from "#server/utils/require-csrf-token"

export async function post(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const cookies = authenticationCookies(authentication.settings.secureCookies)
  requireCsrfToken(
    readCookie(request.headers.cookie, cookies.csrf),
    request.get("x-csrf-token") ?? "",
  )
  const attempt = await authentication.service.start("sign-in")
  response.cookie(cookies.authorization, attempt.browserToken, {
    ...cookies.privateOptions,
    maxAge: 10 * 60_000,
  })
  response.json({ authorizationUrl: attempt.authorizationUrl })
}
