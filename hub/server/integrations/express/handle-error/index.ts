import type { NextFunction, Request, Response } from "express"

import { httpErrorSchema } from "./constants.ts"

/** Keep raw request data and error details out of responses and Express's reporter. */
export function handleError(
  error: unknown,
  _request: Request,
  response: Response,
  // Express identifies error handlers by their four-argument signature.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (response.headersSent) {
    response.destroy()
    return
  }

  const parsed = httpErrorSchema.safeParse(error)
  const status = parsed.success ? parsed.data.status : 500
  response.status(status).json({
    error: status >= 500 ? "Internal server error" : "Invalid request",
  })
}
