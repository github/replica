import type { NextFunction, Request, Response } from "express"

import { IdentityError } from "#server/utils/identity-error"

export function requireHubOrigin(
  origin: string,
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  response.set("Cache-Control", "private, no-store")
  response.set("Referrer-Policy", "no-referrer")
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.get("origin") !== origin) {
    next(
      new IdentityError(
        403,
        "origin_denied",
        "Submit this request from the configured Hub origin.",
      ),
    )
    return
  }
  next()
}
