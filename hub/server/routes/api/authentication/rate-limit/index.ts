import { createHash } from "node:crypto"
import type { RequestHandler } from "express"

import type { AuthenticationRequest, AuthenticationRouteRuntime } from "../types.ts"

export function rateLimit(
  runtime: AuthenticationRouteRuntime,
  operation: "start" | "callback",
  auditBootstrapDenial = false,
): RequestHandler {
  return async (request: AuthenticationRequest, response, next) => {
    const subjectDigest = createHash("sha256")
      .update([operation, request.ip ?? request.socket.remoteAddress ?? "unknown"].join(":"))
      .digest("hex")
    if (!(await runtime.checkRateLimit(operation, subjectDigest))) {
      if (auditBootstrapDenial) await runtime.writeBootstrapDenial("rate_limited")
      response.status(429).json({ error: "Too many authentication attempts. Try again later." })
      return
    }
    next()
  }
}
