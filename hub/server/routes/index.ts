import express from "express"
import type { Express } from "express"

import { handleApiAdministrationGithubCredentialsPut } from "#server/routes/api/administration/github-credentials/put"
import { handleApiAdministrationRevokeSessionsPost } from "#server/routes/api/administration/revoke-sessions/post"
import { handleApiAdministrationSecurityAuditGet } from "#server/routes/api/administration/security-audit/get"
import { handleApiAuthGithubCallbackGet } from "#server/routes/api/auth/github/callback/get"
import { handleApiAuthGithubPost } from "#server/routes/api/auth/github/post"
import { handleApiAuthGithubVerifyPost } from "#server/routes/api/auth/github/verify/post"
import { handleApiHealthGet } from "#server/routes/api/health/get"
import { handleApiOperatorEnrollmentPost } from "#server/routes/api/operator/enrollment/post"
import { handleApiRepositoriesOwnerRepositoryAccessGet } from "#server/routes/api/repositories/[owner]/[repository]/access/get"
import { handleApiSessionDelete } from "#server/routes/api/session/delete"
import { handleApiSessionGet } from "#server/routes/api/session/get"
import { handleApiSetupGithubPost } from "#server/routes/api/setup/github/post"
import { requireHubOrigin } from "#server/utils/require-hub-origin"
import { respondIdentityError } from "#server/utils/respond-identity-error"

import type { IdentityRoutes } from "./types.ts"

export function registerRoutes(app: Express, identity?: IdentityRoutes): void {
  app.get("/api/health", handleApiHealthGet)
  if (!identity) return
  app.use(
    "/api",
    requireHubOrigin.bind(null, identity.settings.origin),
    express.json({ limit: "24kb", strict: true }),
  )
  app.post("/api/setup/github", handleApiSetupGithubPost.bind(null, identity))
  app.post("/api/auth/github", handleApiAuthGithubPost.bind(null, identity))
  app.post("/api/auth/github/verify", handleApiAuthGithubVerifyPost.bind(null, identity))
  app.post("/api/operator/enrollment", handleApiOperatorEnrollmentPost.bind(null, identity))
  app.get("/api/auth/github/callback", handleApiAuthGithubCallbackGet.bind(null, identity))
  app.get("/api/session", handleApiSessionGet.bind(null, identity))
  app.delete("/api/session", handleApiSessionDelete.bind(null, identity))
  app.get(
    "/api/repositories/:owner/:repository/access",
    handleApiRepositoriesOwnerRepositoryAccessGet.bind(null, identity),
  )
  app.put(
    "/api/administration/github-credentials",
    handleApiAdministrationGithubCredentialsPut.bind(null, identity),
  )
  app.post(
    "/api/administration/revoke-sessions",
    handleApiAdministrationRevokeSessionsPost.bind(null, identity),
  )
  app.get(
    "/api/administration/security-audit",
    handleApiAdministrationSecurityAuditGet.bind(null, identity),
  )
  app.use(respondIdentityError)
}
