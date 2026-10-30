import type { RequestHandler } from "express"
import { z } from "zod"

import { AuthenticationProofError } from "../../../../../../domains/authentication/errors.ts"
import { parseBrowserBinding } from "../../../../../../utils/authentication/parse-browser-binding/index.ts"
import { readCookie } from "../../../../../../utils/http/read-cookie/index.ts"
import type { GitHubAuthenticationRoutesDependencies } from "../../types.ts"

const querySchema = z
  .object({
    code: z.string().min(1).max(1_000),
    state: z.string().min(32).max(200),
  })
  .strict()

export function get(dependencies: GitHubAuthenticationRoutesDependencies): RequestHandler {
  return async (request, response) => {
    response.set("Cache-Control", "no-store")
    response.locals.omitLogPayload = true
    const requestIp = request.ip ?? request.socket.remoteAddress ?? "unavailable"
    const rateLimit = await dependencies.reserveRateLimit({ operation: "callback", requestIp })
    if (!rateLimit.reserved) {
      const error = new AuthenticationProofError(
        "rate_limited",
        "Too many authentication callbacks were received.",
      )
      if (rateLimit.shouldAuditDenial) {
        await dependencies.recordRateLimitDenial("callback", error)
      }
      response.status(429).json({ error: error.message })
      return
    }
    const parsed = querySchema.safeParse(request.query)
    const browserBinding = parseBrowserBinding(
      readCookie(request.get("cookie"), "hub_auth_browser"),
    )
    if (!parsed.success || !browserBinding) {
      response.status(400).json({ error: "The authentication callback is invalid." })
      return
    }
    try {
      const result = await dependencies.complete({
        browserBinding,
        code: parsed.data.code,
        state: parsed.data.state,
      })
      response.cookie("hub_auth_browser", browserBinding, {
        httpOnly: true,
        sameSite: "lax",
        secure: dependencies.secureCookies,
        path: "/api/auth",
        expires: result.expiresAt,
      })
      response.status(200).json({
        status: result.status,
        admission: "pending",
        handoffToken: result.handoffToken,
        expiresAt: result.expiresAt.toISOString(),
        identity: result.attributes,
      })
    } catch (error) {
      if (error instanceof AuthenticationProofError) {
        const status = error.code === "attempt_invalid" ? 400 : 502
        response.status(status).json({ error: error.message })
        return
      }
      throw error
    }
  }
}
