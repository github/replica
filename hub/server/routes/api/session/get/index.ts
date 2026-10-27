import { randomBytes } from "node:crypto"
import type { Request, Response } from "express"

import type { AuthenticationRoutes } from "#server/routes/types"
import { authenticationCookies } from "#server/utils/authentication-cookies"
import { AuthenticationError } from "#server/utils/authentication-error"
import { readCookie } from "#server/utils/read-cookie"

export async function get(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const cookies = authenticationCookies(authentication.settings.secureCookies)
  let csrfToken = readCookie(request.headers.cookie, cookies.csrf)
  if (!csrfToken) {
    csrfToken = randomBytes(32).toString("base64url")
    response.cookie(cookies.csrf, csrfToken, cookies.csrfOptions)
  }
  const sessionToken = readCookie(request.headers.cookie, cookies.session)
  try {
    const current = await authentication.service.current(sessionToken)
    response.json({
      authenticated: true,
      configured: authentication.settings.configured,
      admissionPolicy: authentication.settings.admissionPolicy,
      csrfToken,
      user: {
        id: current.user.id,
        displayName: current.user.displayName,
        avatarUrl: current.user.avatarUrl,
        provider: current.externalIdentity.provider,
        username: current.externalIdentity.username,
      },
      session: {
        id: current.id,
        signedInAt: current.signedInAt,
        freshAuthorizedAt: current.freshAuthorizedAt,
      },
    })
  } catch (error) {
    if (!(error instanceof AuthenticationError) || error.status !== 401) throw error
    response.json({
      authenticated: false,
      configured: authentication.settings.configured,
      admissionPolicy: authentication.settings.admissionPolicy,
      csrfToken,
    })
  }
}
