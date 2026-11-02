import { createHash } from "node:crypto"
import type { RequestHandler } from "express"

import type { AuthenticationRequest, RateLimitDependencies } from "../types.ts"

export function rateLimit(
  dependencies: RateLimitDependencies,
  operation: "start" | "callback",
): RequestHandler {
  return async (request: AuthenticationRequest, response, next) => {
    const subjectDigest = createHash("sha256")
      .update([operation, request.ip ?? request.socket.remoteAddress ?? "unknown"].join(":"))
      .digest("hex")
    if (!(await dependencies.checkRateLimit(operation, subjectDigest))) {
      await dependencies.writeRateLimitDenial?.()
      response.status(429).json({ error: "Too many authentication attempts. Try again later." })
      return
    }
    next()
  }
}
