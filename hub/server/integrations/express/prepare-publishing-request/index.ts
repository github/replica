import type { NextFunction, Request, Response } from "express"

export function preparePublishingRequest(
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  response.set("Cache-Control", "private, no-store")
  response.set("Referrer-Policy", "no-referrer")
  next()
}
