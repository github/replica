import type { Request, Response } from "express"

import type { IdentityRoutes } from "#server/routes/types"
import { getIdentityCookies } from "#server/utils/get-identity-cookies"
import { readSessionToken } from "#server/utils/read-session-token"

export async function handleApiAuthGithubVerifyPost(
  dependencies: IdentityRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const { service, settings } = dependencies
  const { oauthName: oauthCookie, options: cookieOptions } = getIdentityCookies(settings)

  const attempt = await service.start({
    purpose: "verify",
    token: readSessionToken(request, settings),
    csrfToken: request.get("x-csrf-token") ?? "",
  })
  response.cookie(oauthCookie, attempt.browserToken, { ...cookieOptions, maxAge: 15 * 60_000 })
  response.json({ url: attempt.url })
}
