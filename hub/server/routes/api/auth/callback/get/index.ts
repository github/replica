import { randomBytes } from "node:crypto"
import type { Request, Response } from "express"

import type { AuthenticationRoutes } from "#server/routes/types"
import { authenticationCookies } from "#server/utils/authentication-cookies"
import { AuthenticationError } from "#server/utils/authentication-error"
import { readCookie } from "#server/utils/read-cookie"

export interface AuthenticationCallbackOptions {
  maximumCodeLength: number
}

function isSingleString(value: unknown): value is string {
  return typeof value === "string"
}

function failureUrl(origin: string, reason: "invalid_callback" | "provider_error"): string {
  const url = new URL(origin)
  url.searchParams.set("authentication", "failed")
  url.searchParams.set("reason", reason)
  return url.href
}

export async function get(
  options: AuthenticationCallbackOptions,
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const cookies = authenticationCookies(authentication.settings.secureCookies)
  response.clearCookie(cookies.authorization, cookies.privateOptions)
  if (request.query.error !== undefined) {
    response.redirect(303, failureUrl(authentication.settings.origin, "provider_error"))
    return
  }
  const { code, state } = request.query
  if (
    !isSingleString(code) ||
    code.length === 0 ||
    code.length > options.maximumCodeLength ||
    !isSingleString(state) ||
    !/^[A-Za-z0-9_-]{43}$/.test(state)
  ) {
    response.redirect(303, failureUrl(authentication.settings.origin, "invalid_callback"))
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
      response.redirect(303, `${authentication.settings.origin}/?authentication=failed`)
      return
    }
    throw error
  }
}
