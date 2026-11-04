import type { RequestHandler } from "express"

export function get(providers: Array<"github" | "entra">): RequestHandler {
  return (_request, response) => {
    response.setHeader("Cache-Control", "no-store")
    response.json({ providers })
  }
}
