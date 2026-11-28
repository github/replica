import type { RequestHandler } from "express"

const readerReturnPath = /^\/private-preview\/launch\/[^/]+\/[^/]+\/return$/

/**
 * Prototype code on the private preview reader shares Hub's site, so SameSite cookies no longer
 * show that an API request came from Hub. Only the reader's signed handoff return may cross.
 */
export function rejectSameSiteApiRequests(readerOrigin: string): RequestHandler {
  return (request, response, next) => {
    if (
      request.get("sec-fetch-site") !== "same-site" ||
      (request.method === "POST" &&
        request.get("origin") === readerOrigin &&
        readerReturnPath.test(request.path))
    ) {
      next()
      return
    }
    response.status(403).json({ error: "The request origin is not allowed." })
  }
}
