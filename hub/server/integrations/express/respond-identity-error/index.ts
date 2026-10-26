import type { NextFunction, Request, Response } from "express"

import { IdentityError } from "#server/utils/identity-error"

export function respondIdentityError(
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (response.headersSent) {
    next(error)
    return
  }
  if (error instanceof IdentityError) {
    response.status(error.status).json({ code: error.code, error: error.message })
    return
  }
  if (
    error instanceof SyntaxError ||
    (error instanceof Error && "type" in error && error.type === "entity.too.large")
  ) {
    response
      .status(400)
      .json({ code: "invalid_body", error: "Supply a JSON request no larger than 24 KiB." })
    return
  }
  console.error("Hub identity request failed. Check database and provider availability.")
  response.status(503).json({
    code: "identity_unavailable",
    error: "Hub could not complete this identity request. Contact the deployment operator.",
  })
}
