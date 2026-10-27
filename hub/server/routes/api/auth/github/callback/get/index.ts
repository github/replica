import { randomBytes } from "node:crypto"
import type { Request, Response } from "express"

import type { AuthenticationRoutes } from "#server/routes/types"
import { authenticationCookies } from "#server/utils/authentication-cookies"
import { AuthenticationError } from "#server/utils/authentication-error"
import { readCookie } from "#server/utils/read-cookie"

function validCallbackValue(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1_000
}

export async function get(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const cookies = authenticationCookies(authentication.settings.secureCookies)
  const failureUrl = `${authentication.settings.origin}/?authentication=failed`
  response.clearCookie(cookies.authorization, cookies.privateOptions)
  const { code, state } = request.query
  if (
    request.query.error !== undefined ||
    !validCallbackValue(code) ||
    !validCallbackValue(state) ||
    !/^[\w-]{43}$/.test(state)
  ) {
    response.redirect(303, failureUrl)
    return
  }
  try {
    const result = await authentication.service.complete(
      code,
      state,
      readCookie(request.headers.cookie, cookies.authorization),
    )
    if (result.sessionToken) {
      response.cookie(cookies.session, result.sessionToken, cookies.privateOptions)
    }
    response.cookie(cookies.csrf, randomBytes(32).toString("base64url"), cookies.csrfOptions)
    response.redirect(303, `${authentication.settings.origin}/?authentication=complete`)
  } catch (error) {
    if (error instanceof AuthenticationError) {
      response.redirect(303, failureUrl)
      return
    }
    throw error
  }
}
