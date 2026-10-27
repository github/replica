import type { NextFunction, Request, Response } from "express"

/** Exclude authentication request payloads while retaining completion metadata. */
export function omitRequestLogPayload(_request: Request, response: Response, next: NextFunction) {
  response.locals.omitLogPayload = true
  next()
}
