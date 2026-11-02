import express from "express"
import type { Express } from "express"

import { adminEnrollmentStart } from "./admin-enrollment-start/index.ts"
import { callback } from "./callback/index.ts"
import { current } from "./current/index.ts"
import { rateLimit } from "./rate-limit/index.ts"
import { requireOrigin } from "./require-origin/index.ts"
import { signOut } from "./sign-out/index.ts"
import { start } from "./start/index.ts"
import type { AuthenticationRouteDependencies } from "./types.ts"

export function authenticationRoutes(
  app: Express,
  dependencies: AuthenticationRouteDependencies,
): void {
  app.post(
    "/api/auth/github/start",
    requireOrigin(dependencies.signIn.applicationOrigin),
    rateLimit(dependencies.signIn, "start"),
    express.urlencoded({ extended: false, limit: "4kb" }),
    start(dependencies.signIn),
  )
  app.post(
    "/api/auth/github/admin-enrollment/start",
    requireOrigin(dependencies.administratorEnrollment.applicationOrigin),
    rateLimit(dependencies.administratorEnrollment, "start"),
    express.urlencoded({ extended: false, limit: "4kb" }),
    adminEnrollmentStart(dependencies.administratorEnrollment),
  )
  app.get(
    "/api/auth/github/callback",
    rateLimit(dependencies.callback, "callback"),
    callback(dependencies.callback),
  )
  app.get("/api/auth/session", current(dependencies.currentSession))
  app.post(
    "/api/auth/session/sign-out",
    requireOrigin(dependencies.signOut.applicationOrigin),
    signOut(dependencies.signOut),
  )
}
