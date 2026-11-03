import type { RequestHandler } from "express"

export function authenticationSecurity(): RequestHandler {
  return (_request, response, next) => {
    response.locals.omitLogPayload = true
    response.setHeader("Cache-Control", "no-store")
    response.setHeader("Pragma", "no-cache")
    next()
  }
}
