import type { Request, Response } from "express"

import type { IdentityRoutes } from "#server/routes/types"
import { getIdentityCookies } from "#server/utils/get-identity-cookies"

export async function post(
  dependencies: IdentityRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const { service, settings } = dependencies
  const { sessionName, options: cookieOptions } = getIdentityCookies(settings)
  const result = await service.signInWithGitHubDemo(request.body)

  response.cookie(sessionName, result.token, cookieOptions)
  response.status(201).json({ signedIn: true })
}
