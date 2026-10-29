import type { Request, Response } from "express"

import type { AuthenticationRoutes } from "#server/routes/types"
import { authenticationCookies } from "#server/utils/authentication-cookies"
import { readCookie } from "#server/utils/read-cookie"

export async function get(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const cookies = authenticationCookies(authentication.settings.secureCookies)
  response.json(
    await authentication.administration.list(readCookie(request.headers.cookie, cookies.session), {
      memberships:
        typeof request.query.membershipsCursor === "string"
          ? request.query.membershipsCursor
          : undefined,
      invitations:
        typeof request.query.invitationsCursor === "string"
          ? request.query.invitationsCursor
          : undefined,
    }),
  )
}
