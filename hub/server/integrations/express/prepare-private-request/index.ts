import type { NextFunction, Request, Response } from "express"

export function preparePrivateRequest(
  checkOrigin: (origin: string | undefined) => void,
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  response.set("Cache-Control", "private, no-store")
  response.set("Referrer-Policy", "no-referrer")
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    checkOrigin(request.get("origin"))
  }
  next()
}
