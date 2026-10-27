import { randomBytes } from "node:crypto"
import type { Request, Response } from "express"

import type { AuthenticationRoutes } from "#server/routes/types"
import { authenticationCookies } from "#server/utils/authentication-cookies"
import { readCookie } from "#server/utils/read-cookie"
import { requireCsrfToken } from "#server/utils/require-csrf-token"

async function deleteSession(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const cookies = authenticationCookies(authentication.settings.secureCookies)
  requireCsrfToken(
    readCookie(request.headers.cookie, cookies.csrf),
    request.get("x-csrf-token") ?? "",
  )
  await authentication.service.signOut(readCookie(request.headers.cookie, cookies.session))
  response.clearCookie(cookies.session, cookies.privateOptions)
  response.clearCookie(cookies.authorization, cookies.privateOptions)
  response.cookie(cookies.csrf, randomBytes(32).toString("base64url"), cookies.csrfOptions)
  response.status(204).end()
}

export { deleteSession as delete }
