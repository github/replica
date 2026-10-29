import type { Request, Response } from "express"

import type { AuthorizationPurpose } from "#server/domains/authentication/create-service/types"
import type { AuthenticationRoutes } from "#server/routes/types"
import { authenticationCookies } from "#server/utils/authentication-cookies"
import { requireCsrfToken } from "#server/utils/require-csrf-token"
import { readCookie } from "#server/utils/read-cookie"

export async function post(
  authentication: AuthenticationRoutes,
  purpose: Extract<AuthorizationPurpose, "bootstrap" | "recovery">,
  request: Request,
  response: Response,
): Promise<void> {
  const cookies = authenticationCookies(authentication.settings.secureCookies)
  requireCsrfToken(
    readCookie(request.headers.cookie, cookies.csrf),
    request.get("x-csrf-token") ?? "",
  )
  const secret =
    request.body &&
    typeof request.body === "object" &&
    !Array.isArray(request.body) &&
    typeof (request.body as Record<string, unknown>).secret === "string"
      ? (request.body as Record<string, string>).secret
      : ""
  const attempt = await authentication.service.start(purpose, undefined, secret)
  response.cookie(cookies.authorization, attempt.browserToken, {
    ...cookies.privateOptions,
    maxAge: 10 * 60_000,
  })
  response.json({ authorizationUrl: attempt.authorizationUrl })
}
