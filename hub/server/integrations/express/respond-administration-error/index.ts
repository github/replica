import type { NextFunction, Request, Response } from "express"

import { AuthenticationError } from "#server/utils/authentication-error"

export function respondAdministrationError(
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (!(error instanceof AuthenticationError)) {
    next(error)
    return
  }
  if (error.code === "csrf_failed" || error.code === "origin_failed") {
    response.status(403).json({ error: "Request not allowed" })
    return
  }
  response.status(error.status).json({ error: error.code, message: error.message })
}
