import type { Request, Response } from "express"

import { get as handleAuthenticationCallback } from "#server/routes/api/auth/callback/get"
import type { AuthenticationRoutes } from "#server/routes/types"

export const maximumGitHubAuthorizationCodeLength = 1_000

export async function get(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  await handleAuthenticationCallback(
    { maximumCodeLength: maximumGitHubAuthorizationCodeLength },
    authentication,
    request,
    response,
  )
}
