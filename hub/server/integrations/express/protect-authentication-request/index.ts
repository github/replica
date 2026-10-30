import type { RequestHandler } from "express"

export function protectAuthenticationRequest(): RequestHandler {
  return (request, response, next) => {
    if (request.path.startsWith("/api/auth/")) {
      response.set("Cache-Control", "no-store")
      response.locals.omitLogPayload = true
    }
    next()
  }
}
