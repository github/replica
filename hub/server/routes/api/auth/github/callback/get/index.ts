import { randomUUID } from "node:crypto"
import type { RequestHandler } from "express"
import { z } from "zod"

import { AdmissionDeniedError } from "../../../../../../domains/admission/errors.ts"
import { AuthenticationProofError } from "../../../../../../domains/authentication/errors.ts"
import { createOpaqueValue } from "../../../../../../domains/authentication/create-opaque-value/index.ts"
import { hashAuthenticationValue } from "../../../../../../domains/authentication/hash-authentication-value/index.ts"
import { browserAuthenticationCookieName } from "../../../../../../integrations/express/browser-authentication-cookie-name/index.ts"
import { clearAuthenticationCookie } from "../../../../../../integrations/express/clear-authentication-cookie/index.ts"
import { createAuthenticationCookie } from "../../../../../../integrations/express/create-authentication-cookie/index.ts"
import { hubSessionCookieName } from "../../../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../../../integrations/express/read-cookie/index.ts"
import type { AuthenticationCallbackDependencies } from "../../../types.ts"

const querySchema = z
  .object({
    code: z.string().min(1).max(1_000),
    state: z.string().min(32).max(200),
  })
  .strict()
const browserBindingSchema = z.string().min(32).max(200)

export function get(dependencies: AuthenticationCallbackDependencies): RequestHandler {
  return async (request, response, next) => {
    const query = querySchema.safeParse(request.query)
    const browserBinding = browserBindingSchema.safeParse(
      readCookie(request, browserAuthenticationCookieName),
    )
    if (!query.success || !browserBinding.success) {
      response.setHeader(
        "Set-Cookie",
        clearAuthenticationCookie(browserAuthenticationCookieName, dependencies.secureCookie),
      )
      response.redirect(303, "/?authentication=denied")
      return
    }
    try {
      const completed = await dependencies.complete({
        browserBinding: browserBinding.data,
        code: query.data.code,
        state: query.data.state,
      })
      const sessionValue = createOpaqueValue()
      const admitted = await dependencies.admit({
        proof: completed.proof,
        sessionDigest: hashAuthenticationValue(sessionValue),
        sessionId: randomUUID(),
      })
      response.setHeader("Set-Cookie", [
        clearAuthenticationCookie(browserAuthenticationCookieName, dependencies.secureCookie),
        createAuthenticationCookie({
          expiresAt: admitted.expiresAt,
          name: hubSessionCookieName,
          secure: dependencies.secureCookie,
          value: sessionValue,
        }),
      ])
      response.redirect(303, "/?authentication=success")
    } catch (error) {
      if (error instanceof AdmissionDeniedError || error instanceof AuthenticationProofError) {
        response.setHeader(
          "Set-Cookie",
          clearAuthenticationCookie(browserAuthenticationCookieName, dependencies.secureCookie),
        )
        response.redirect(303, "/?authentication=denied")
        return
      }
      next(error)
    }
  }
}
