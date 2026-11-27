import type { RequestHandler } from "express"
import { z } from "zod"

import type { RepositoryAnalyticsProof } from "../../../../../domains/analytics/hosted-authorization/types.ts"
import { hashAuthenticationValue } from "../../../../../domains/authentication/hash-authentication-value/index.ts"
import { clearAuthenticationCookie } from "../../../../../integrations/express/clear-authentication-cookie/index.ts"
import { readCookie } from "../../../../../integrations/express/read-cookie/index.ts"
import { readHubSessionCookie } from "../../../../../integrations/express/read-hub-session-cookie/index.ts"
import type { AnalyticsRouteDependencies } from "../types.ts"

export const analyticsBrowserCookie = "hub_analytics_auth_browser"
const opaque = z.string().min(32).max(200)
const callback = z.strictObject({
  state: opaque,
  code: z.string().min(1).max(2_048).optional(),
  error: z.string().min(1).max(128).optional(),
  error_description: z.string().max(500).optional(),
  error_uri: z.string().max(500).optional(),
  iss: z.string().max(500).optional(),
})

/** Match the dedicated state and browser cookie before dispatching to any proof flow. */
export function repositoryAnalyticsCallback(
  proof?: RepositoryAnalyticsProof,
  authorization?: AnalyticsRouteDependencies["hostedAuthorization"],
): RequestHandler {
  return async (request, response, next) => {
    if (!proof || !authorization) return next()
    const binding = opaque.safeParse(readCookie(request, analyticsBrowserCookie))
    const query = callback.safeParse(request.query)
    if (
      !binding.success ||
      !query.success ||
      (query.data.iss !== undefined && query.data.iss !== proof.callbackIssuer)
    )
      return next()
    const cookie = readHubSessionCookie(request)
    const result = await authorization.complete(proof, {
      browserBinding: binding.data,
      state: query.data.state,
      code: query.data.error ? undefined : query.data.code,
      digest: cookie ? hashAuthenticationValue(cookie) : null,
    })
    if (!result) return next()
    response.setHeader(
      "Set-Cookie",
      clearAuthenticationCookie(analyticsBrowserCookie, proof.secureCookie),
    )
    response.redirect(303, result.redirect)
  }
}
