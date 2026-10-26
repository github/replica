import type { Request, Response } from "express"

import type { IdentityRoutes } from "#server/routes/types"
import { getIdentityCookies } from "#server/utils/get-identity-cookies"

export async function post(
  dependencies: IdentityRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const { service, settings } = dependencies
  const { oauthName: oauthCookie, options: cookieOptions } = getIdentityCookies(settings)

  const attempt = await service.start({
    purpose: "enroll",
    bootstrapSecret: request.get("x-hub-bootstrap-secret"),
  })
  response.cookie(oauthCookie, attempt.browserToken, { ...cookieOptions, maxAge: 15 * 60_000 })
  response.json({ url: attempt.url })
}
