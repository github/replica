import type { Request, Response } from "express"

import type { IdentityRoutes } from "#server/routes/types"
import { getIdentityCookies } from "#server/utils/get-identity-cookies"
import { readConfirmation } from "#server/utils/read-confirmation"
import { readSessionToken } from "#server/utils/read-session-token"

export async function handleApiAdministrationRevokeSessionsPost(
  dependencies: IdentityRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const { service, settings } = dependencies
  const { sessionName: sessionCookie, options: cookieOptions } = getIdentityCookies(settings)

  await service.revoke(
    readSessionToken(request, settings),
    request.get("x-csrf-token") ?? "",
    readConfirmation(request.body),
  )
  response.clearCookie(sessionCookie, cookieOptions)
  response.status(204).end()
}
