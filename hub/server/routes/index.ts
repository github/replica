import express from "express"
import type { Express } from "express"

import { requireHubOrigin } from "#server/domains/identity/require-hub-origin"
import { preparePrivateRequest } from "#server/integrations/express/prepare-private-request"
import { respondIdentityError } from "#server/integrations/express/respond-identity-error"
import { put as handleApiAdministrationGithubCredentialsPut } from "#server/routes/api/administration/github-credentials/put"
import { post as handleApiAdministrationRevokeSessionsPost } from "#server/routes/api/administration/revoke-sessions/post"
import { get as handleApiAdministrationSecurityAuditGet } from "#server/routes/api/administration/security-audit/get"
import { get as handleApiAuthGithubCallbackGet } from "#server/routes/api/auth/github/callback/get"
import { post as handleApiAuthGithubPost } from "#server/routes/api/auth/github/post"
import { post as handleApiAuthGithubVerifyPost } from "#server/routes/api/auth/github/verify/post"
import { get as handleApiHealthGet } from "#server/routes/api/health/get"
import { post as handleApiOperatorEnrollmentPost } from "#server/routes/api/operator/enrollment/post"
import { get as handleApiRepositoriesOwnerRepositoryAccessGet } from "#server/routes/api/repositories/[owner]/[repository]/access/get"
import { delete as handleApiSessionDelete } from "#server/routes/api/session/delete"
import { get as handleApiSessionGet } from "#server/routes/api/session/get"
import { post as handleApiSetupGithubPost } from "#server/routes/api/setup/github/post"
import type { IdentityRoutes } from "#server/routes/types"

export function routes(app: Express, identity?: IdentityRoutes): void {
  app.get("/api/health", handleApiHealthGet)
  if (!identity) return
  app.use(
    "/api",
    preparePrivateRequest.bind(null, requireHubOrigin.bind(null, identity.settings.origin)),
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
