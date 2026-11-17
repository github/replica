import express from "express"
import type { Express } from "express"

import { rateLimit } from "../integrations/express/authentication-rate-limit/index.ts"
import { requireOrigin } from "../integrations/express/require-origin/index.ts"
import { post as handleAdministratorEnrollmentStartPost } from "./api/auth/admin-enrollment/start/post/index.ts"
import { get as handleAuthenticationCallbackGet } from "./api/auth/callback/get/index.ts"
import { get as handleCurrentSessionGet } from "./api/auth/session/get/index.ts"
import { get as handleAuthenticationProvidersGet } from "./api/auth/providers/get/index.ts"
import { post as handleSignOutPost } from "./api/auth/session/sign-out/post/index.ts"
import { post as handleAuthenticationStartPost } from "./api/auth/start/post/index.ts"
import { get as handleApiHealthGet } from "./api/health/get/index.ts"
import { get as handleApiReadyGet } from "./api/ready/get/index.ts"
import { get as handleWorkspaceGet } from "./api/workspace/get/index.ts"
import { get as handleRepositoryAuthorsGet } from "./api/repositories/authors/get/index.ts"
import { get as handleRepositoryGet } from "./api/repositories/show/get/index.ts"
import { get as handlePrototypeGet } from "./api/repositories/prototypes/show/get/index.ts"
import { patch as handlePrototypePatch } from "./api/repositories/prototypes/show/patch/index.ts"
import { get as handleBuildHistoryGet } from "./api/repositories/prototypes/builds/get/index.ts"
import { get as handleReviewCommentsGet } from "./api/repositories/prototypes/review-comments/get/index.ts"
import { post as handleReviewCommentsPost } from "./api/repositories/prototypes/review-comments/post/index.ts"
import { patch as handleReviewCommentPatch } from "./api/repositories/prototypes/review-comments/comment/patch/index.ts"
import { delete_ as handleReviewCommentDelete } from "./api/repositories/prototypes/review-comments/comment/delete/index.ts"
import { post as handleReviewCommentReplyPost } from "./api/repositories/prototypes/review-comments/replies/post/index.ts"
import { post as handleReviewThreadResolutionPost } from "./api/repositories/prototypes/review-comments/resolution/post/index.ts"
import { delete_ as handleReviewThreadResolutionDelete } from "./api/repositories/prototypes/review-comments/resolution/delete/index.ts"
import { get as handleBuildPreviewAccessGet } from "./api/repositories/prototypes/builds/access/get/index.ts"
import { get as handleBuildPreviewAuthorizeGet } from "./build-preview/authorize/get/index.ts"
import { get as handleBuildPreviewServeGet } from "./build-preview/serve/get/index.ts"
import { get as handleSharePreviewAuthorizeGet } from "./build-preview/share-authorize/get/index.ts"
import { get as handleSharingSettingsGet } from "./api/public-sharing/settings/get/index.ts"
import { patch as handleSharingSettingsPatch } from "./api/public-sharing/settings/patch/index.ts"
import { get as handleShareLinksGet } from "./api/public-sharing/links/get/index.ts"
import { post as handleShareLinksPost } from "./api/public-sharing/links/post/index.ts"
import { del as handleShareLinksDelete } from "./api/public-sharing/links/delete/index.ts"
import { get as handlePublicShareGet } from "./api/public-sharing/public/get/index.ts"
import { get as handlePublicSharePreviewGet } from "./api/public-sharing/public-preview/get/index.ts"
import { get as handleAdministratorsGet } from "./api/administrators/get/index.ts"
import { get as handleAdministratorCandidatesGet } from "./api/administrators/candidates/get/index.ts"
import { post as handleAdministratorAuthorizationStartPost } from "./api/administrators/authorizations/start/post/index.ts"
import { post as handleAdministratorAuthorizationContinuePost } from "./api/administrators/authorizations/continue/post/index.ts"
import { post as handleAdministratorAuthorizationCancelPost } from "./api/administrators/authorizations/cancel/post/index.ts"
import { get as handleAdministratorAuthorizationGet } from "./api/administrators/authorizations/get/index.ts"
import { rateLimit as administratorAuthorizationRateLimit } from "./api/administrators/authorizations/start/rate-limit/index.ts"
import { get as handleSecurityAuditsGet } from "./api/security-audits/get/index.ts"
import { get as handleSessionRevocationGet } from "./api/session-revocation/get/index.ts"
import { post as handleSessionRevocationAuthorizationStartPost } from "./api/session-revocation/authorizations/start/post/index.ts"
import { get as handleSessionRevocationAuthorizationGet } from "./api/session-revocation/authorizations/get/index.ts"
import { post as handleSessionRevocationAuthorizationContinuePost } from "./api/session-revocation/authorizations/continue/post/index.ts"
import { post as handleSessionRevocationAuthorizationCancelPost } from "./api/session-revocation/authorizations/cancel/post/index.ts"
import { get as handleCopilotConnectionGet } from "./api/copilot-connection/get/index.ts"
import { post as handleCopilotAuthorizationStartPost } from "./api/copilot-connection/authorizations/start/post/index.ts"
import { get as handleCopilotAuthorizationGet } from "./api/copilot-connection/authorizations/get/index.ts"
import { post as handleCopilotAuthorizationContinuePost } from "./api/copilot-connection/authorizations/continue/post/index.ts"
import { post as handleCopilotAuthorizationCancelPost } from "./api/copilot-connection/authorizations/cancel/post/index.ts"
import { get as handleLearningsGet } from "./api/learnings/get/index.ts"
import { post as handleLearningRunPost } from "./api/learnings/runs/post/index.ts"
import { post as handleLearningDecisionPost } from "./api/learnings/decision/post/index.ts"
import type { RouteDependencies } from "./types.ts"

/** Keep endpoint registration separate from the app's shared middleware. */
export function routes(app: Express, dependencies: RouteDependencies = {}): void {
  const {
    authentication,
    copilotConnection,
    isReady,
    learnings,
    logger,
    preview,
    product,
    publicSharing,
  } = dependencies
  if (preview) {
    app.get("/__replica/authorize", handleBuildPreviewAuthorizeGet(preview))
    if (publicSharing) {
      app.get("/__replica/share/authorize", handleSharePreviewAuthorizeGet(preview, publicSharing))
    }
    app.get("/{*path}", handleBuildPreviewServeGet(preview))
  }
  app.get("/api/health", handleApiHealthGet)
  app.get("/api/ready", (request, response) =>
    handleApiReadyGet(request, response, { isReady, logger }),
  )
  if (authentication) {
    if (product) {
      app.get("/api/workspace", handleWorkspaceGet(authentication.currentSession, product))
      app.get(
        "/api/repositories/:repositoryId",
        handleRepositoryGet(authentication.currentSession, product),
      )
      app.get(
        "/api/repositories/:repositoryId/authors",
        handleRepositoryAuthorsGet(authentication.currentSession, product),
      )
      app.get(
        "/api/repositories/:repositoryId/prototypes/:prototypeId",
        handlePrototypeGet(authentication.currentSession, product),
      )
      app.get(
        "/api/repositories/:repositoryId/prototypes/:prototypeId/builds",
        handleBuildHistoryGet(authentication.currentSession, product),
      )
      if (preview) {
        app.get(
          "/api/repositories/:repositoryId/prototypes/:prototypeId/builds/:buildNumber/access",
          handleBuildPreviewAccessGet(authentication.currentSession, product, preview),
        )
      }
      app.patch(
        "/api/repositories/:repositoryId/prototypes/:prototypeId",
        requireOrigin(authentication.signOut.applicationOrigin),
        express.json({ limit: "32kb", strict: true }),
        handlePrototypePatch(authentication.currentSession, product),
      )
      if (product.reviewComments) {
        const reviewCommentsPath =
          "/api/repositories/:repositoryId/prototypes/:prototypeId/review-comments"
        app.get(
          reviewCommentsPath,
          handleReviewCommentsGet(authentication.currentSession, product.reviewComments),
        )
        app.post(
          reviewCommentsPath,
          requireOrigin(authentication.signOut.applicationOrigin),
          express.json({ limit: "32kb", strict: true }),
          handleReviewCommentsPost(authentication.currentSession, product.reviewComments),
        )
        app.patch(
          `${reviewCommentsPath}/:commentId`,
          requireOrigin(authentication.signOut.applicationOrigin),
          express.json({ limit: "32kb", strict: true }),
          handleReviewCommentPatch(authentication.currentSession, product.reviewComments),
        )
        app.delete(
          `${reviewCommentsPath}/:commentId`,
          requireOrigin(authentication.signOut.applicationOrigin),
          handleReviewCommentDelete(authentication.currentSession, product.reviewComments),
        )
        app.post(
          `${reviewCommentsPath}/:threadId/replies`,
          requireOrigin(authentication.signOut.applicationOrigin),
          express.json({ limit: "32kb", strict: true }),
          handleReviewCommentReplyPost(authentication.currentSession, product.reviewComments),
        )
        app.post(
          `${reviewCommentsPath}/:threadId/resolution`,
          requireOrigin(authentication.signOut.applicationOrigin),
          handleReviewThreadResolutionPost(authentication.currentSession, product.reviewComments),
        )
        app.delete(
          `${reviewCommentsPath}/:threadId/resolution`,
          requireOrigin(authentication.signOut.applicationOrigin),
          handleReviewThreadResolutionDelete(authentication.currentSession, product.reviewComments),
        )
      }
      if (publicSharing) {
        app.get(
          "/api/product/sharing-settings",
          handleSharingSettingsGet(authentication.currentSession, publicSharing),
        )
        app.patch(
          "/api/product/sharing-settings",
          requireOrigin(authentication.signOut.applicationOrigin),
          express.json({ limit: "4kb", strict: true }),
          handleSharingSettingsPatch(authentication.currentSession, publicSharing),
        )
        app.get(
          "/api/repositories/:repositoryId/prototypes/:prototypeId/share-links",
          handleShareLinksGet(authentication.currentSession, product, publicSharing),
        )
        app.post(
          "/api/repositories/:repositoryId/prototypes/:prototypeId/share-links",
          requireOrigin(authentication.signOut.applicationOrigin),
          express.json({ limit: "4kb", strict: true }),
          handleShareLinksPost(authentication.currentSession, publicSharing),
        )
        app.delete(
          "/api/repositories/:repositoryId/prototypes/:prototypeId/share-links/:shareId",
          requireOrigin(authentication.signOut.applicationOrigin),
          handleShareLinksDelete(authentication.currentSession, publicSharing),
        )
      }
    }
    if (learnings) {
      app.get("/api/repositories/:repositoryId/learnings", handleLearningsGet(learnings))
      app.post(
        "/api/repositories/:repositoryId/learnings/runs",
        requireOrigin(learnings.applicationOrigin),
        handleLearningRunPost(learnings),
      )
      app.post(
        "/api/repositories/:repositoryId/learnings/:learningId/decision",
        requireOrigin(learnings.applicationOrigin),
        express.json({ limit: "4kb", strict: true }),
        handleLearningDecisionPost(learnings),
      )
    }
    if (authentication.administrators) {
      app.get("/api/security-audits", handleSecurityAuditsGet(authentication.administrators))
      app.get("/api/administrators", handleAdministratorsGet(authentication.administrators))
      app.get(
        "/api/administrators/candidates",
        handleAdministratorCandidatesGet(authentication.administrators),
      )
      app.post(
        "/api/administrators/authorizations/start",
        requireOrigin(authentication.administrators.applicationOrigin),
        administratorAuthorizationRateLimit(authentication.administrators),
        express.json({ limit: "4kb", strict: true }),
        handleAdministratorAuthorizationStartPost(authentication.administrators),
      )
      app.get(
        "/api/administrators/authorizations/:id",
        handleAdministratorAuthorizationGet(authentication.administrators),
      )
      app.post(
        "/api/administrators/authorizations/continue",
        requireOrigin(authentication.administrators.applicationOrigin),
        express.json({ limit: "4kb", strict: true }),
        handleAdministratorAuthorizationContinuePost(authentication.administrators),
      )
      app.post(
        "/api/administrators/authorizations/cancel",
        requireOrigin(authentication.administrators.applicationOrigin),
        express.json({ limit: "4kb", strict: true }),
        handleAdministratorAuthorizationCancelPost(authentication.administrators),
      )
    }
    if (authentication.sessionRevocation) {
      app.get(
        "/api/session-revocation",
        handleSessionRevocationGet(authentication.sessionRevocation),
      )
      app.post(
        "/api/session-revocation/authorizations/start",
        requireOrigin(authentication.sessionRevocation.applicationOrigin),
        administratorAuthorizationRateLimit(authentication.sessionRevocation),
        express.json({ limit: "4kb", strict: true }),
        handleSessionRevocationAuthorizationStartPost(authentication.sessionRevocation),
      )
      app.get(
        "/api/session-revocation/authorizations/:id",
        handleSessionRevocationAuthorizationGet(authentication.sessionRevocation),
      )
      app.post(
        "/api/session-revocation/authorizations/continue",
        requireOrigin(authentication.sessionRevocation.applicationOrigin),
        express.json({ limit: "4kb", strict: true }),
        handleSessionRevocationAuthorizationContinuePost(authentication.sessionRevocation),
      )
      app.post(
        "/api/session-revocation/authorizations/cancel",
        requireOrigin(authentication.sessionRevocation.applicationOrigin),
        express.json({ limit: "4kb", strict: true }),
        handleSessionRevocationAuthorizationCancelPost(authentication.sessionRevocation),
      )
    }
    app.get(
      "/api/auth/providers",
      handleAuthenticationProvidersGet([
        ...(authentication.github ? (["github"] as const) : []),
        ...(authentication.entra ? (["entra"] as const) : []),
        ...(authentication.local ? (["local"] as const) : []),
      ]),
    )
    if (authentication.github) {
      app.post(
        "/api/auth/github/start",
        requireOrigin(authentication.github.signIn.applicationOrigin),
        rateLimit(authentication.github.signIn, "start"),
        express.urlencoded({ extended: false, limit: "4kb" }),
        handleAuthenticationStartPost(authentication.github.signIn),
      )
      app.post(
        "/api/auth/github/admin-enrollment/start",
        requireOrigin(authentication.github.administratorEnrollment.applicationOrigin),
        rateLimit(authentication.github.administratorEnrollment, "start"),
        express.urlencoded({ extended: false, limit: "4kb" }),
        handleAdministratorEnrollmentStartPost(authentication.github.administratorEnrollment),
      )
      app.get(
        "/api/auth/github/callback",
        rateLimit(authentication.github.callback, "callback"),
        handleAuthenticationCallbackGet(authentication.github.callback),
      )
    }
    if (authentication.entra) {
      app.post(
        "/api/auth/entra/start",
        requireOrigin(authentication.entra.signIn.applicationOrigin),
        rateLimit(authentication.entra.signIn, "start"),
        express.urlencoded({ extended: false, limit: "4kb" }),
        handleAuthenticationStartPost(authentication.entra.signIn),
      )
      app.post(
        "/api/auth/entra/admin-enrollment/start",
        requireOrigin(authentication.entra.administratorEnrollment.applicationOrigin),
        rateLimit(authentication.entra.administratorEnrollment, "start"),
        express.urlencoded({ extended: false, limit: "4kb" }),
        handleAdministratorEnrollmentStartPost(authentication.entra.administratorEnrollment),
      )
      app.get(
        "/api/auth/entra/callback",
        rateLimit(authentication.entra.callback, "callback"),
        handleAuthenticationCallbackGet(authentication.entra.callback),
      )
    }
    if (authentication.local) {
      app.post(
        "/api/auth/local/start",
        requireOrigin(authentication.local.signIn.applicationOrigin),
        rateLimit(authentication.local.signIn, "start"),
        express.urlencoded({ extended: false, limit: "4kb" }),
        handleAuthenticationStartPost(authentication.local.signIn),
      )
      app.get(
        "/api/auth/local/callback",
        rateLimit(authentication.local.callback, "callback"),
        handleAuthenticationCallbackGet(authentication.local.callback),
      )
    }
    app.get("/api/auth/session", handleCurrentSessionGet(authentication.currentSession))
    app.post(
      "/api/auth/session/sign-out",
      requireOrigin(authentication.signOut.applicationOrigin),
      handleSignOutPost(authentication.signOut),
    )
  }
  if (publicSharing) {
    app.get("/api/shared/:shareId", handlePublicShareGet(publicSharing))
    if (preview) {
      app.get("/api/shared/:shareId/preview", handlePublicSharePreviewGet(publicSharing, preview))
    }
  }
  if (copilotConnection) {
    app.get("/api/copilot-connection", handleCopilotConnectionGet(copilotConnection))
    app.post(
      "/api/copilot-connection/authorizations/start",
      requireOrigin(copilotConnection.applicationOrigin),
      administratorAuthorizationRateLimit(copilotConnection.authorization!),
      express.json({ limit: "4kb", strict: true }),
      handleCopilotAuthorizationStartPost(copilotConnection),
    )
    app.get(
      "/api/copilot-connection/authorizations/:id",
      handleCopilotAuthorizationGet(copilotConnection),
    )
    app.post(
      "/api/copilot-connection/authorizations/continue",
      requireOrigin(copilotConnection.applicationOrigin),
      express.json({ limit: "4kb", strict: true }),
      handleCopilotAuthorizationContinuePost(copilotConnection),
    )
    app.post(
      "/api/copilot-connection/authorizations/cancel",
      requireOrigin(copilotConnection.applicationOrigin),
      express.json({ limit: "4kb", strict: true }),
      handleCopilotAuthorizationCancelPost(copilotConnection),
    )
  }
}
