import express from "express"
import type { Express } from "express"

import { rateLimit } from "../integrations/express/authentication-rate-limit/index.ts"
import { requireOrigin } from "../integrations/express/require-origin/index.ts"
import { get as handleAuthenticationCallbackGet } from "./api/auth/github/callback/get/index.ts"
import { post as handleAdministratorEnrollmentStartPost } from "./api/auth/github/admin-enrollment/start/post/index.ts"
import { post as handleAuthenticationStartPost } from "./api/auth/github/start/post/index.ts"
import { get as handleCurrentSessionGet } from "./api/auth/session/get/index.ts"
import { post as handleSignOutPost } from "./api/auth/session/sign-out/post/index.ts"
import { get as handleApiHealthGet } from "./api/health/get/index.ts"
import { get as handleApiReadyGet } from "./api/ready/get/index.ts"
import type { RouteDependencies } from "./types.ts"

/** Keep endpoint registration separate from the app's shared middleware. */
export function routes(app: Express, dependencies: RouteDependencies = {}): void {
  const { authentication, isReady, logger } = dependencies
  app.get("/api/health", handleApiHealthGet)
  app.get("/api/ready", (request, response) =>
    handleApiReadyGet(request, response, { isReady, logger }),
  )
  if (authentication) {
    app.post(
      "/api/auth/github/start",
      requireOrigin(authentication.signIn.applicationOrigin),
      rateLimit(authentication.signIn, "start"),
      express.urlencoded({ extended: false, limit: "4kb" }),
      handleAuthenticationStartPost(authentication.signIn),
    )
    app.post(
      "/api/auth/github/admin-enrollment/start",
      requireOrigin(authentication.administratorEnrollment.applicationOrigin),
      rateLimit(authentication.administratorEnrollment, "start"),
      express.urlencoded({ extended: false, limit: "4kb" }),
      handleAdministratorEnrollmentStartPost(authentication.administratorEnrollment),
    )
    app.get(
      "/api/auth/github/callback",
      rateLimit(authentication.callback, "callback"),
      handleAuthenticationCallbackGet(authentication.callback),
    )
    app.get("/api/auth/session", handleCurrentSessionGet(authentication.currentSession))
    app.post(
      "/api/auth/session/sign-out",
      requireOrigin(authentication.signOut.applicationOrigin),
      handleSignOutPost(authentication.signOut),
    )
  }
}
