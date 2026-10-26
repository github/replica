import type { Request, Response } from "express"

import type { IdentityRoutes } from "#server/routes/types"
import { getIdentityCookies } from "#server/utils/get-identity-cookies"
import { readSessionToken } from "#server/utils/read-session-token"

async function deleteSession(
  dependencies: IdentityRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const { service, settings } = dependencies
  const { sessionName: sessionCookie, options: cookieOptions } = getIdentityCookies(settings)

  await service.signOut(readSessionToken(request, settings), request.get("x-csrf-token") ?? "")
  response.clearCookie(sessionCookie, cookieOptions)
  response.status(204).end()
}

export { deleteSession as delete }
