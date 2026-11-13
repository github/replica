import { randomUUID } from "node:crypto"
import type { RequestHandler } from "express"
import { z } from "zod"

import { AdmissionDeniedError } from "../../../../../domains/admission/errors.ts"
import { AuthenticationProofError } from "../../../../../domains/authentication/errors.ts"
import { createOpaqueValue } from "../../../../../domains/authentication/create-opaque-value/index.ts"
import { hashAuthenticationValue } from "../../../../../domains/authentication/hash-authentication-value/index.ts"
import { browserAuthenticationCookieName } from "../../../../../integrations/express/browser-authentication-cookie-name/index.ts"
import { clearAuthenticationCookie } from "../../../../../integrations/express/clear-authentication-cookie/index.ts"
import { createAuthenticationCookie } from "../../../../../integrations/express/create-authentication-cookie/index.ts"
import { githubRepositoryDenialCookieName } from "../../../../../integrations/express/github-repository-denial-cookie-name/index.ts"
import { hubSessionCookieName } from "../../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../../integrations/express/read-cookie/index.ts"
import type { AuthenticationCallbackDependencies } from "../../types.ts"

const querySchema = z
  .object({
    code: z.string().min(1).max(2_048),
    iss: z.string().min(1).max(500).optional(),
    session_state: z.string().min(1).max(500).optional(),
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
    if (
      !query.success ||
      !browserBinding.success ||
      (query.data.iss !== undefined && query.data.iss !== dependencies.callbackIssuer)
    ) {
      response.setHeader(
        "Set-Cookie",
        clearAuthenticationCookie(browserAuthenticationCookieName, dependencies.secureCookie),
      )
      response.redirect(303, "/?authentication=denied")
      return
    }
    let githubLogin: string | undefined
    try {
      const completed = await dependencies.complete({
        browserBinding: browserBinding.data,
        code: query.data.code,
        state: query.data.state,
      })
      githubLogin = completed.githubLogin
      if (completed.purpose === "ADMINISTRATOR_MANAGEMENT") {
        const hubSessionValue = readCookie(request, hubSessionCookieName)
        if (
          !completed.sensitiveAuthorizationId ||
          !hubSessionValue ||
          !dependencies.verifyAdministratorAuthorization ||
          !(await dependencies.verifyAdministratorAuthorization({
            authorizationAttemptId: completed.proof.authorizationAttemptId,
            externalIdentityId: completed.proof.externalIdentityId,
            providerAssignment: completed.providerAssignment,
            sessionDigest: hashAuthenticationValue(hubSessionValue),
            sensitiveAuthorizationId: completed.sensitiveAuthorizationId,
          }))
        ) {
          throw new AuthenticationProofError(
            "attempt_invalid",
            "The administrator authorization is no longer available.",
          )
        }
        response.setHeader(
          "Set-Cookie",
          clearAuthenticationCookie(browserAuthenticationCookieName, dependencies.secureCookie),
        )
        response.redirect(
          303,
          `/settings/administrators/confirm?authorizationId=${completed.sensitiveAuthorizationId}`,
        )
        return
      }
      const sessionValue = createOpaqueValue()
      const admitted = await dependencies.admit({
        proof: completed.proof,
        providerAssignment: completed.providerAssignment,
        repositoryAccess: completed.repositoryAccess,
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
        const noAccess =
          error instanceof AdmissionDeniedError && error.reason === "no_repository_access"
        const cookies = [
          clearAuthenticationCookie(browserAuthenticationCookieName, dependencies.secureCookie),
        ]
        if (
          noAccess &&
          githubLogin &&
          /^[a-z0-9-]{1,39}$/i.test(githubLogin) &&
          dependencies.createGitHubRepositoryDenialNotice
        ) {
          const notice = dependencies.createGitHubRepositoryDenialNotice(githubLogin)
          cookies.push(
            createAuthenticationCookie({
              ...notice,
              name: githubRepositoryDenialCookieName,
              secure: dependencies.secureCookie,
            }),
          )
        }
        response.setHeader("Set-Cookie", cookies)
        response.redirect(303, noAccess ? "/signed-in/no-access" : "/?authentication=denied")
        return
      }
      next(error)
    }
  }
}
