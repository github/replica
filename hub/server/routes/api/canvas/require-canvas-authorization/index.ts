import type { RequestHandler } from "express"

export function requireCanvasAuthorization(): RequestHandler {
  return (request, response, next) => {
    if (!/^Bearer [^\s]{20,4096}$/.test(request.get("authorization") ?? "")) {
      response.status(401).json({
        code: "canvas_authorization_required",
        error: "Connect this repository to Hub before requesting prototype evaluation.",
      })
      return
    }
    next()
  }
}
