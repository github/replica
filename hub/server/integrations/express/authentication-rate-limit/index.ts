import { createHash } from "node:crypto"
import type { Request, RequestHandler } from "express"

interface RateLimitDependencies {
  checkRateLimit(
    operation: "start" | "callback",
    subjectDigest: string,
  ): Promise<{ allowed: boolean; auditFailed: boolean }>
}

interface AuthenticationRequest extends Request {
  authenticationRateLimitAllowed?: boolean
}

export function rateLimit(
  dependencies: RateLimitDependencies,
  operation: "start" | "callback",
): RequestHandler {
  return async (request: AuthenticationRequest, response, next) => {
    const subjectDigest = createHash("sha256")
      .update([operation, request.ip ?? request.socket.remoteAddress ?? "unknown"].join(":"))
      .digest("hex")
    const decision = await dependencies.checkRateLimit(operation, subjectDigest)
    if (!decision.allowed) {
      if (decision.auditFailed) {
        request.log.error("Bootstrap rate-limit denial audit failed")
      }
      response.status(429).json({ error: "Too many authentication attempts. Try again later." })
      return
    }
    next()
  }
}
