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
  await authentication.service.revokeAll(readCookie(request.headers.cookie, cookies.session))
  response.clearCookie(cookies.session, cookies.privateOptions)
  response.status(204).end()
}
