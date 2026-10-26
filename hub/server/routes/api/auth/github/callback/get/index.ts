import type { Request, Response } from "express"

import type { IdentityRoutes } from "#server/routes/types"
import { getIdentityCookies } from "#server/utils/get-identity-cookies"
import { IdentityError } from "#server/utils/identity-error"
import { readCookie } from "#server/utils/read-cookie"

export async function handleApiAuthGithubCallbackGet(
  dependencies: IdentityRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const { service, settings } = dependencies
  const {
    sessionName: sessionCookie,
    oauthName: oauthCookie,
    options: cookieOptions,
  } = getIdentityCookies(settings)

  const { code, state } = request.query
  response.clearCookie(oauthCookie, cookieOptions)
  if (
    typeof code !== "string" ||
    typeof state !== "string" ||
    code.length > 1000 ||
    !/^[\w-]{43}$/.test(state)
  ) {
    throw new IdentityError(
      400,
      "invalid_callback",
      "GitHub sign-in was not completed. Start again.",
    )
  }
  const result = await service.complete(
    code,
    state,
    readCookie(request.headers.cookie, oauthCookie),
  )
  if (result.token) response.cookie(sessionCookie, result.token, cookieOptions)
  response.redirect(303, `${settings.origin}/api/session`)
}
