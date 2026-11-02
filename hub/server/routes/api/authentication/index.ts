import express from "express"
import type { Express } from "express"

import { adminEnrollmentStart } from "./admin-enrollment-start/index.ts"
import { callback } from "./callback/index.ts"
import { current } from "./current/index.ts"
import { rateLimit } from "./rate-limit/index.ts"
import { requireOrigin } from "./require-origin/index.ts"
import { signOut } from "./sign-out/index.ts"
import { start } from "./start/index.ts"
import type { AuthenticationRouteRuntime } from "./types.ts"

export function authenticationRoutes(app: Express, runtime: AuthenticationRouteRuntime): void {
  app.post(
    "/api/auth/github/start",
    requireOrigin(runtime.applicationOrigin),
    rateLimit(runtime, "start"),
    express.urlencoded({ extended: false, limit: "4kb" }),
    start(runtime, "SIGN_IN"),
  )
  app.post(
    "/api/auth/github/admin-enrollment/start",
    requireOrigin(runtime.applicationOrigin),
    rateLimit(runtime, "start", true),
    express.urlencoded({ extended: false, limit: "4kb" }),
    adminEnrollmentStart(runtime),
  )
  app.get("/api/auth/github/callback", rateLimit(runtime, "callback"), callback(runtime))
  app.get("/api/auth/session", current(runtime))
  app.post("/api/auth/session/sign-out", requireOrigin(runtime.applicationOrigin), signOut(runtime))
}
