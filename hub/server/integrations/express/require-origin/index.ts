import type { RequestHandler } from "express"

export function requireOrigin(applicationOrigin: string): RequestHandler {
  return (request, response, next) => {
    if (request.headers.origin !== applicationOrigin) {
      response.status(403).json({ error: "The request origin is not allowed." })
      return
    }
    next()
  }
}
