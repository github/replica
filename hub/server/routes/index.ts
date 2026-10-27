import type { Express } from "express"

import { createRateLimit } from "#server/integrations/express/create-rate-limit"
import { prepareAuthenticationRequest } from "#server/integrations/express/prepare-authentication-request"
import { respondAuthenticationError } from "#server/integrations/express/respond-authentication-error"
import { respondAdministrationError } from "#server/integrations/express/respond-administration-error"
import { get as handleApiAuthGithubCallbackGet } from "#server/routes/api/auth/github/callback/get"
import { post as handleApiAuthGithubPost } from "#server/routes/api/auth/github/post"
import { post as handleApiAuthEnrollmentPost } from "#server/routes/api/auth/enrollment/post"
import { get as handleApiAdministrationGet } from "#server/routes/api/administration/get"
import { post as handleApiAdministrationInvitationsPost } from "#server/routes/api/administration/invitations/post"
import { remove as handleApiAdministrationInvitationsDelete } from "#server/routes/api/administration/invitations/delete"
import { patch as handleApiAdministrationMembershipsPatch } from "#server/routes/api/administration/memberships/patch"
import { get as handleApiHealthGet } from "./api/health/get/index.ts"
import { delete as handleApiSessionDelete } from "#server/routes/api/session/delete"
import { get as handleApiSessionGet } from "#server/routes/api/session/get"
import { post as handleApiSessionRevokeAllPost } from "#server/routes/api/session/revoke-all/post"
import { post as handleApiSessionVerifyPost } from "#server/routes/api/session/verify/post"
import {
  archivePrototype,
  createPrototype,
  createPublisherCredential,
  createWorkspace,
  explainPrototypeAccess,
  getPrototype,
  getVersion,
  getWorkspace,
  listPrototypes,
  listVersions,
  listWorkspaces,
  removePrototypeAccess,
  removeWorkspaceAccess,
  revokePublisherCredential,
  setPublisherActive,
  setPrototypeAccess,
  setPrototypeAuthorization,
  setWorkspaceAccess,
} from "#server/routes/product"
import {
  linkRepository,
  listRepositories,
  processWebhook,
  reconcileRepository,
  unlinkRepository,
  updateRepository,
} from "#server/routes/github-authorization"
import { getPublicationStatus, promoteVersion, publishArtifact } from "#server/routes/publishing"
import type { AuthenticationRoutes } from "#server/routes/types"

/** Keep endpoint registration separate from the app's shared middleware. */
export function routes(app: Express, authentication?: AuthenticationRoutes): void {
  app.get("/api/health", handleApiHealthGet)
  if (!authentication) return
  if (authentication.githubAuthorization) {
    app.post("/api/github/webhooks", processWebhook.bind(null, authentication))
  }

  app.use(
    ["/api/auth", "/api/session", "/api/administration", "/api/workspaces", "/api/prototypes"],
    prepareAuthenticationRequest.bind(null, authentication.settings.origin),
  )
  const initiationLimit = createRateLimit({
    limit: 20,
    windowMilliseconds: 5 * 60_000,
  })
  const callbackLimit = createRateLimit({
    limit: 60,
    windowMilliseconds: 5 * 60_000,
  })
  app.post("/api/auth/github", initiationLimit, handleApiAuthGithubPost.bind(null, authentication))
  app.get(
    "/api/auth/github/callback",
    callbackLimit,
    handleApiAuthGithubCallbackGet.bind(null, authentication),
  )
  app.get("/api/session", handleApiSessionGet.bind(null, authentication))
  app.delete("/api/session", handleApiSessionDelete.bind(null, authentication))
  app.post(
    "/api/session/verify",
    initiationLimit,
    handleApiSessionVerifyPost.bind(null, authentication),
  )
  app.post("/api/session/revoke-all", handleApiSessionRevokeAllPost.bind(null, authentication))
  app.post(
    "/api/auth/bootstrap",
    initiationLimit,
    handleApiAuthEnrollmentPost.bind(null, authentication, "bootstrap"),
  )
  app.post(
    "/api/auth/recovery",
    initiationLimit,
    handleApiAuthEnrollmentPost.bind(null, authentication, "recovery"),
  )
  app.get("/api/administration", handleApiAdministrationGet.bind(null, authentication))
  app.post(
    "/api/administration/invitations",
    handleApiAdministrationInvitationsPost.bind(null, authentication),
  )
  app.delete(
    "/api/administration/invitations/:id",
    handleApiAdministrationInvitationsDelete.bind(null, authentication),
  )
  app.patch(
    "/api/administration/memberships/:id",
    handleApiAdministrationMembershipsPatch.bind(null, authentication),
  )
  if (authentication.githubAuthorization) {
    app.get("/api/administration/github/repositories", listRepositories.bind(null, authentication))
    app.post("/api/administration/github/repositories", linkRepository.bind(null, authentication))
    app.patch(
      "/api/administration/github/repositories/:repositorySourceId",
      updateRepository.bind(null, authentication),
    )
    app.delete(
      "/api/administration/github/repositories/:repositorySourceId",
      unlinkRepository.bind(null, authentication),
    )
    app.post(
      "/api/administration/github/repositories/:repositorySourceId/reconcile",
      reconcileRepository.bind(null, authentication),
    )
  }
  app.use("/api/administration", respondAdministrationError)
  const productMutationLimit = createRateLimit({
    limit: 120,
    windowMilliseconds: 5 * 60_000,
    message: "Too many product requests.",
  })
  app.get("/api/workspaces", listWorkspaces.bind(null, authentication))
  app.post("/api/workspaces", productMutationLimit, createWorkspace.bind(null, authentication))
  app.get("/api/workspaces/:workspaceId", getWorkspace.bind(null, authentication))
  app.put(
    "/api/workspaces/:workspaceId/access/:userId",
    productMutationLimit,
    setWorkspaceAccess.bind(null, authentication),
  )
  app.delete(
    "/api/workspaces/:workspaceId/access/:userId",
    productMutationLimit,
    removeWorkspaceAccess.bind(null, authentication),
  )
  app.get("/api/workspaces/:workspaceId/prototypes", listPrototypes.bind(null, authentication))
  app.post(
    "/api/workspaces/:workspaceId/prototypes",
    productMutationLimit,
    createPrototype.bind(null, authentication),
  )
  app.get("/api/prototypes/:prototypeId", getPrototype.bind(null, authentication))
  app.post(
    "/api/prototypes/:prototypeId/archive",
    productMutationLimit,
    archivePrototype.bind(null, authentication),
  )
  app.put(
    "/api/prototypes/:prototypeId/authorization",
    productMutationLimit,
    setPrototypeAuthorization.bind(null, authentication),
  )
  app.post(
    "/api/prototypes/:prototypeId/publishers",
    productMutationLimit,
    createPublisherCredential.bind(null, authentication),
  )
  app.patch(
    "/api/prototypes/:prototypeId/publishers/:publisherId",
    productMutationLimit,
    setPublisherActive.bind(null, authentication),
  )
  app.delete(
    "/api/prototypes/:prototypeId/publishers/:publisherId/credentials/:credentialId",
    productMutationLimit,
    revokePublisherCredential.bind(null, authentication),
  )
  app.get(
    "/api/prototypes/:prototypeId/access/explanation",
    explainPrototypeAccess.bind(null, authentication),
  )
  app.put(
    "/api/prototypes/:prototypeId/access/:userId",
    productMutationLimit,
    setPrototypeAccess.bind(null, authentication),
  )
  app.delete(
    "/api/prototypes/:prototypeId/access/:userId",
    productMutationLimit,
    removePrototypeAccess.bind(null, authentication),
  )
  app.get("/api/prototypes/:prototypeId/versions", listVersions.bind(null, authentication))
  app.get("/api/prototypes/:prototypeId/versions/:versionId", getVersion.bind(null, authentication))
  app.use(["/api/workspaces", "/api/prototypes"], respondAdministrationError)
  if (authentication.artifactPublishing) {
    const publishingLimit = createRateLimit({
      limit: 60,
      windowMilliseconds: 5 * 60_000,
      message: "Too many publishing requests.",
    })
    app.post(
      "/api/publishing/prototypes/:prototypeId/versions",
      publishingLimit,
      publishArtifact.bind(null, authentication.artifactPublishing),
    )
    app.get(
      "/api/publishing/prototypes/:prototypeId/status",
      publishingLimit,
      getPublicationStatus.bind(null, authentication.artifactPublishing),
    )
    app.put(
      "/api/publishing/prototypes/:prototypeId/channels/:channel",
      publishingLimit,
      promoteVersion.bind(null, authentication.artifactPublishing),
    )
    app.use("/api/publishing", respondAdministrationError)
  }
  app.use(respondAuthenticationError)
}
