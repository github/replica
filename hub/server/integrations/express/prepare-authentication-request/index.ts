import type { NextFunction, Request, Response } from "express"

import { AuthenticationError } from "#server/utils/authentication-error"

export function prepareAuthenticationRequest(
  expectedOrigin: string,
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  response.set("Cache-Control", "private, no-store")
  response.set("Referrer-Policy", "no-referrer")
  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    request.get("origin") !== expectedOrigin
  ) {
    next(new AuthenticationError(403, "origin_failed", "The request origin did not match."))
    return
  }
  next()
}
