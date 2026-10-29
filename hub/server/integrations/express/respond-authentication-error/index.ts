import type { NextFunction, Request, Response } from "express"

import { AuthenticationError } from "#server/utils/authentication-error"

export function respondAuthenticationError(
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (!(error instanceof AuthenticationError)) {
    next(error)
    return
  }
  const message =
    error.status === 401
      ? "Authentication required"
      : error.status === 403
        ? "Request not allowed"
        : error.status === 429
          ? "Too many requests"
          : error.status >= 500
            ? "Authentication unavailable"
            : "Authentication failed"
  response.status(error.status).json({ error: message })
}
