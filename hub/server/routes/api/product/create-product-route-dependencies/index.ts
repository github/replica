import { Prisma } from "../../../../generated/prisma/client.ts"
import { createAnalyticsDestinationService } from "../../../../domains/analytics/create-destination-service/index.ts"
import { createHostedAnalyticsAuthorization } from "../../../../domains/analytics/hosted-authorization/index.ts"
import { recordAnalyticsEvent } from "../../../../domains/analytics/record-event/index.ts"
import type { AnalyticsSettings } from "../../../../domains/analytics/types.ts"
import { restoreHubSession } from "../../../../domains/admission/restore-hub-session/index.ts"
import { runSessionRestoreTransaction } from "../../../../domains/admission/run-session-restore-transaction/index.ts"
import { createBuildPreviewOrigin } from "../../../../domains/build-preview/create-build-preview-origin/index.ts"
import { editPrototypeMetadata } from "../../../../domains/prototypes/edit-prototype-metadata/index.ts"
import { PrototypeMetadataError } from "../../../../domains/prototypes/errors.ts"
import { readPrototypeWithIntroduction } from "../../../../domains/prototypes/read-prototype-with-introduction/index.ts"
import { authorizeRepositoryReview } from "../../../../domains/review-comments/authorize-repository-review/index.ts"
import { createReviewCommentService } from "../../../../domains/review-comments/create-review-comment-service/index.ts"
import { createReviewInbox } from "../../../../domains/review-comments/create-review-inbox/index.ts"
import {
  createReviewMentionDirectory,
  githubReviewId,
} from "../../../../domains/review-comments/create-review-mention-directory/index.ts"
import { ReviewCommentError } from "../../../../domains/review-comments/errors.ts"
import type { GitHubReviewDirectory } from "../../../../integrations/github/create-review-directory/types.ts"
import { prisma } from "../../../../integrations/prisma/index.ts"
import { readRepositoryPermission } from "../../../../integrations/github/read-repository-permission/index.ts"
import type {
  RepositoryPermission,
  RepositoryPermissionInput,
} from "../../../../integrations/github/read-repository-permission/types.ts"
import { lockAuthenticationProvidersForPrototypeEdit } from "../../../../repositories/authentication-providers/lock-authentication-providers-for-prototype-edit/index.ts"
import { findBuildPreviewTarget } from "../../../../repositories/build-artifacts/find-build-preview-target/index.ts"
import { findDefaultTemplateBuild } from "../../../../repositories/build-artifacts/find-default-template-build/index.ts"
import { lockGitHubRepositoryAccessState } from "../../../../repositories/github-repository-access-states/lock-github-repository-access-state/index.ts"
import { readGitHubRepositoryAccessState } from "../../../../repositories/github-repository-access-states/read-github-repository-access-state/index.ts"
import { findLocalPrototypeManagement } from "../../../../repositories/prototype-index/find-local-prototype-management/index.ts"
import { findRepositoryAuthors } from "../../../../repositories/prototype-index/find-repository-authors/index.ts"
import { findRepositoryIndex } from "../../../../repositories/prototype-index/find-repository-index/index.ts"
import { findRepositoryPermissionSubject } from "../../../../repositories/prototype-index/find-repository-permission-subject/index.ts"
import { findPrototypeDetail } from "../../../../repositories/prototype-index/find-prototype-detail/index.ts"
import { listRepositories } from "../../../../repositories/prototype-index/list-repositories/index.ts"
import {
  type RepositoryScope,
  visibleRepositoryWhere,
} from "../../../../repositories/prototype-index/visible-repository-where/index.ts"
import { recordPrototypeIntroduction } from "../../../../repositories/prototype-introductions/record-prototype-introduction/index.ts"
import { lockEditablePrototype } from "../../../../repositories/prototypes/lock-editable-prototype/index.ts"
import { lockVisiblePrototype } from "../../../../repositories/prototypes/lock-visible-prototype/index.ts"
import { findRepositoryReviewAccess } from "../../../../repositories/review-comments/find-repository-review-access/index.ts"
import { findReviewRepository } from "../../../../repositories/review-comments/collaboration-queries/index.ts"
import { findSessionGitHubSubject } from "../../../../repositories/review-comments/inbox-queries/index.ts"
import { updatePrototypeMetadata } from "../../../../repositories/prototypes/update-prototype-metadata/index.ts"
import { recordRepositoryAudit } from "../../../../repositories/security-audits/record-repository-audit/index.ts"
import { lockSessionRevocationState } from "../../../../repositories/session-revocation-states/lock-session-revocation-state/index.ts"
import { findCurrentSessionProfile } from "../../../../repositories/user-profiles/find-current-session-profile/index.ts"
import {
  hideWelcome,
  isWelcomeHidden,
} from "../../../../repositories/users/welcome-preference/index.ts"
import { canWriteRepository } from "../../../../utils/can-write-repository/index.ts"
import { localDeveloperIdentity } from "../../../../utils/local-developer-identity/index.ts"
import type { AnalyticsViewer } from "../../repositories/analytics/types.ts"
import { readWithPersistedRepositoryScope } from "../read-with-persisted-repository-scope/index.ts"
import { resolvePersistedRepositoryScope } from "../resolve-persisted-repository-scope/index.ts"
import type { resolveRepositoryScope } from "../resolve-repository-scope/index.ts"
import type { ProductViewer, WorkspaceProductRouteDependencies } from "../types.ts"

interface CreateProductRouteDependenciesOptions {
  analyticsSettings?: AnalyticsSettings
  localAnalyticsAdministration?: boolean
  applicationOrigin?: string
  githubRepositoryCredentials?: RepositoryPermissionInput["credentials"]
  requestGitHub?: typeof fetch
  scopeGitHubMembers?: boolean
  githubReviewDirectory?: GitHubReviewDirectory
  authorizeReviewMutation?: (
    transaction: Prisma.TransactionClient,
    sessionDigest: string,
    userId: string,
    repositoryId: string,
  ) => Promise<boolean>
  onReviewCommentDeleted?: (input: {
    repositoryId: string
    commentId: number
    actorLogin: string
  }) => Promise<void>
  previewBaseOrigin?: string
  getRepositoryPermission?: WorkspaceProductRouteDependencies["getRepositoryPermission"]
  withReviewCommentDeleteLock?: <T>(operation: () => Promise<T>) => Promise<T>
}

export function createProductRouteDependencies({
  analyticsSettings,
  localAnalyticsAdministration = false,
  applicationOrigin,
  githubRepositoryCredentials,
  requestGitHub,
  scopeGitHubMembers = false,
  githubReviewDirectory,
  authorizeReviewMutation,
  onReviewCommentDeleted,
  previewBaseOrigin,
  getRepositoryPermission: permissionOverride,
  withReviewCommentDeleteLock,
}: CreateProductRouteDependenciesOptions = {}): WorkspaceProductRouteDependencies {
  function scope(
    viewer: Parameters<typeof resolveRepositoryScope>[0],
    database: Pick<Prisma.TransactionClient, "gitHubRepositoryAccessState"> = prisma,
  ) {
    return resolvePersistedRepositoryScope(database, viewer, scopeGitHubMembers)
  }
  function readScoped<Result>(
    viewer: Parameters<typeof resolveRepositoryScope>[0],
    read: (scope: RepositoryScope) => Promise<Result>,
    database: Pick<Prisma.TransactionClient, "gitHubRepositoryAccessState"> = prisma,
  ) {
    return readWithPersistedRepositoryScope(database, viewer, scopeGitHubMembers, read)
  }
  function joinTransaction(transaction: Prisma.TransactionClient) {
    return {
      $transaction: <Result>(read: (client: Prisma.TransactionClient) => Promise<Result>) =>
        read(transaction),
      repository: transaction.repository,
    }
  }
  async function lockAuthority(transaction: Prisma.TransactionClient) {
    await lockAuthenticationProvidersForPrototypeEdit(transaction)
    await lockSessionRevocationState(transaction)
    return lockGitHubRepositoryAccessState(transaction)
  }
  async function restoreSession(
    transaction: Prisma.TransactionClient,
    joined: Parameters<typeof runSessionRestoreTransaction>[0],
    digest: string,
  ) {
    const session = await restoreHubSession(digest, {
      runTransaction: (restore) => runSessionRestoreTransaction(joined, restore),
    })
    if (!session) return null
    const profile = await findCurrentSessionProfile(transaction, session)
    return profile ? { ...session, ...profile } : null
  }
  async function repositoryIsVisible(
    database: Pick<Prisma.TransactionClient, "gitHubRepositoryAccessState" | "repository">,
    repositoryId: string,
    viewer: Parameters<typeof resolveRepositoryScope>[0],
  ) {
    return readScoped(
      viewer,
      async (repositoryScope) =>
        Boolean(
          await database.repository.findFirst({
            where: { id: repositoryId, ...visibleRepositoryWhere(repositoryScope) },
            select: { id: true },
          }),
        ),
      database,
    )
  }
  async function getRepositoryPermissionEvidence(
    viewer: ProductViewer,
    repositoryId: string,
    branchName?: string,
  ): Promise<{ permission: RepositoryPermission | null; accessRevision: number | null }> {
    const denied = { permission: null, accessRevision: null }
    const { revision } = await readGitHubRepositoryAccessState(prisma)
    const repository = await readScoped(viewer, (repositoryScope) =>
      prisma.repository.findFirst({
        where: { id: repositoryId, ...visibleRepositoryWhere(repositoryScope) },
        select: { githubRepositoryId: true, localPath: true },
      }),
    )
    if (!repository) return denied
    if (repository.localPath) {
      return viewer.sessionProvider === "local" && viewer.role === "ADMINISTRATOR"
        ? { permission: "admin", accessRevision: null }
        : denied
    }
    if (
      viewer.sessionProvider !== "github" ||
      !viewer.externalIdentityId ||
      !repository.githubRepositoryId ||
      !githubRepositoryCredentials
    ) {
      return denied
    }
    const identity = await findRepositoryPermissionSubject(
      prisma,
      viewer.externalIdentityId,
      viewer.membershipId,
    )
    if (!identity) return denied
    const permission = await readRepositoryPermission(
      {
        ...identity,
        credentials: githubRepositoryCredentials,
        githubRepositoryId: repository.githubRepositoryId,
        branchName,
      },
      requestGitHub,
    )
    if (
      !permission ||
      !(await repositoryIsVisible(prisma, repositoryId, viewer)) ||
      (await readGitHubRepositoryAccessState(prisma)).revision !== revision
    ) {
      return denied
    }
    return { permission, accessRevision: revision }
  }
  async function getRepositoryPermission(viewer: ProductViewer, repositoryId: string) {
    if (permissionOverride) return permissionOverride(viewer, repositoryId)
    return (await getRepositoryPermissionEvidence(viewer, repositoryId)).permission ?? "none"
  }
  async function isLocalAnalyticsAdministrator(
    viewer: Pick<AnalyticsViewer, "sessionProvider" | "role" | "userId" | "externalIdentityId">,
    repositoryId: string,
    database: Pick<Prisma.TransactionClient, "repository" | "externalIdentity"> = prisma,
  ) {
    if (
      !localAnalyticsAdministration ||
      viewer.sessionProvider !== "local" ||
      viewer.role !== "ADMINISTRATOR" ||
      !viewer.externalIdentityId
    )
      return false
    const repository = await database.repository.findFirst({
      where: {
        id: repositoryId,
        removedAt: null,
        githubRepositoryId: null,
        localPath: { not: null },
      },
      select: { id: true },
    })
    if (!repository) return false
    return Boolean(
      await database.externalIdentity.findFirst({
        where: { ...localDeveloperIdentity, id: viewer.externalIdentityId, userId: viewer.userId },
        select: { id: true },
      }),
    )
  }
  const analytics =
    analyticsSettings && createAnalyticsDestinationService(prisma, analyticsSettings)
  const authorizeReview =
    authorizeReviewMutation ??
    (async (
      transaction: Prisma.TransactionClient,
      sessionDigest: string,
      userId: string,
      repositoryId: string,
    ) => {
      await lockAuthority(transaction)
      const restored = await restoreSession(
        transaction,
        joinTransaction(transaction),
        sessionDigest,
      )
      if (restored?.userId !== userId) return false
      // Report a hidden repository as missing so members cannot probe for it.
      const repository = await findRepositoryReviewAccess(transaction, repositoryId)
      if (
        !authorizeRepositoryReview(restored, repository).canChange ||
        !(await repositoryIsVisible(transaction, repositoryId, restored))
      ) {
        throw new ReviewCommentError("not_found", "Repository not found.")
      }
      return true
    })
  const buildArtifactUrl =
    applicationOrigin && previewBaseOrigin
      ? (
          buildId: string,
          repositoryId: string,
          prototypeId: string,
          buildNumber: number,
          target: "preview" | "desktop" | "narrow",
        ) => {
          const url = new URL(
            `/api/repositories/${repositoryId}/prototypes/${prototypeId}/builds/${buildNumber}/access`,
            applicationOrigin,
          )
          url.searchParams.set("target", target)
          url.searchParams.set(
            "preview_origin",
            createBuildPreviewOrigin(buildId, previewBaseOrigin),
          )
          return url.toString()
        }
      : undefined
  const mentions = createReviewMentionDirectory(prisma, githubReviewDirectory)
  return {
    getRepositoryPermission,
    async getVerifiedRepositoryPermission(viewer, repositoryId) {
      if (permissionOverride) return permissionOverride(viewer, repositoryId)
      return (await getRepositoryPermissionEvidence(viewer, repositoryId)).permission
    },
    templates: {
      findBuild: (viewer, repositoryId, buildId) =>
        readScoped(viewer, (repositoryScope) =>
          findDefaultTemplateBuild(prisma, repositoryId, repositoryScope, buildId),
        ),
    },
    welcome: {
      isHidden: (userId) => isWelcomeHidden(prisma, userId),
      hide: (sessionDigest, userId) =>
        prisma.$transaction(async (transaction) => {
          await lockAuthority(transaction)
          const current = await restoreSession(
            transaction,
            joinTransaction(transaction),
            sessionDigest,
          )
          if (current?.userId !== userId) return false
          await hideWelcome(transaction, userId)
          return true
        }),
    },
    analytics:
      analyticsSettings && analytics
        ? {
            applicationOrigin: analyticsSettings.applicationOrigin,
            localAdministration: localAnalyticsAdministration,
            isLocalAdministrator: isLocalAnalyticsAdministrator,
            hostedAuthorization:
              githubRepositoryCredentials || permissionOverride
                ? createHostedAnalyticsAuthorization(
                    prisma,
                    analytics,
                    analyticsSettings.encryptionKey,
                    {
                      getRepositoryPermission,
                      restoreSession: (transaction, digest) =>
                        restoreSession(transaction, joinTransaction(transaction), digest),
                    },
                  )
                : undefined,
            list: (repositoryId) => analytics.list(repositoryId),
            mutate: (actor, mutation, digest) =>
              analytics.mutate(actor, mutation, async (transaction) => {
                await lockAuthority(transaction)
                const viewer = await restoreSession(
                  transaction,
                  joinTransaction(transaction),
                  digest,
                )
                return (
                  viewer?.membershipId === actor.membershipId &&
                  (await isLocalAnalyticsAdministrator(viewer, actor.repositoryId, transaction))
                )
              }),
          }
        : undefined,
    reviewComments: createReviewCommentService(prisma, authorizeReview, {
      onDeleted: onReviewCommentDeleted,
      withDeleteLock: withReviewCommentDeleteLock,
      resolveMentions: (input, logins) => mentions.resolve(input, logins),
    }),
    searchReviewMentions: (...args) => mentions.search(...args),
    isPrototypeReviewable: async (repositoryId, prototypeId) =>
      Boolean(await findReviewRepository(prisma, repositoryId, prototypeId)),
    reviewInbox: createReviewInbox(prisma, {
      restore: async (transaction, digest) => {
        await lockAuthority(transaction)
        return restoreSession(transaction, joinTransaction(transaction), digest)
      },
      repositoryScope: async (database, viewer) =>
        visibleRepositoryWhere(await scope(viewer, database)),
      github: githubReviewDirectory,
    }),
    authorizeReviewAccess: async (repositoryId, actor, signal) => {
      const repository = await findRepositoryReviewAccess(prisma, repositoryId)
      const access = authorizeRepositoryReview(actor, repository)
      const denied = { canView: false, canChange: false }
      if (
        !repository ||
        !access.canView ||
        !(await repositoryIsVisible(prisma, repositoryId, actor))
      ) {
        return denied
      }
      if (!repository.localPath && actor.sessionProvider === "github" && githubReviewDirectory) {
        if (!actor.sessionDigest || !repository.githubRepositoryId) return denied
        const session = await findSessionGitHubSubject(prisma, actor.sessionDigest)
        const identity = session?.externalIdentity
        const githubId =
          identity?.provider === "github" && identity.issuer === "https://github.com"
            ? githubReviewId(`github:${identity.subject}`)
            : undefined
        if (!githubId) return denied
        try {
          if (
            !(await githubReviewDirectory.canRead(
              repository.githubRepositoryId,
              actor.login,
              githubId,
              signal,
            ))
          )
            return denied
        } catch {
          throw new ReviewCommentError(
            "unavailable",
            "GitHub could not check review access. Try again.",
          )
        }
        if (!(await repositoryIsVisible(prisma, repositoryId, actor))) return denied
      }
      return access
    },
    isRepositoryVisible: (viewer, repositoryId) =>
      repositoryIsVisible(prisma, repositoryId, viewer),
    listRepositories: (viewer) =>
      readScoped(viewer, (repositoryScope) => listRepositories(prisma, repositoryScope)),
    findLocalPrototypeManagement: async (viewer, repositoryId) =>
      viewer.sessionProvider === "local" && viewer.role === "ADMINISTRATOR"
        ? findLocalPrototypeManagement(prisma, repositoryId)
        : null,
    findPrototypeManagement: async (viewer, repositoryId) => {
      if (!canWriteRepository(await getRepositoryPermission(viewer, repositoryId))) return null
      return findLocalPrototypeManagement(
        prisma,
        repositoryId,
        viewer.sessionProvider === "local" ? "local" : "github",
      )
    },
    findRepositoryIndex: (viewer, repositoryId, filters) =>
      readScoped(viewer, (repositoryScope) =>
        findRepositoryIndex(prisma, repositoryId, filters, repositoryScope),
      ),
    findPrototypeDetail: (viewer, repositoryId, prototypeId, buildNumber, buildPage) =>
      readScoped(viewer, (repositoryScope) =>
        findPrototypeDetail(
          prisma,
          repositoryId,
          prototypeId,
          buildNumber,
          buildPage,
          repositoryScope,
          buildArtifactUrl,
        ),
      ),
    readPrototypeWithIntroduction: (input, prepare) =>
      readPrototypeWithIntroduction(input, {
        prepare,
        runTransaction: (operation) =>
          prisma.$transaction(
            async (transaction) => {
              await lockAuthority(transaction)
              const joined = joinTransaction(transaction)
              return operation({
                restoreSession: (digest) => restoreSession(transaction, joined, digest),
                lockPrototype: async (repositoryId, prototypeId, viewer) =>
                  (await repositoryIsVisible(transaction, repositoryId, viewer))
                    ? lockVisiblePrototype(transaction, repositoryId, prototypeId)
                    : null,
                findDetail: async (repositoryId, prototypeId, viewer, buildNumber) =>
                  findPrototypeDetail(
                    joined,
                    repositoryId,
                    prototypeId,
                    buildNumber,
                    undefined,
                    await scope(viewer, transaction),
                    buildArtifactUrl,
                  ),
                recordIntroduction: (userId, prototypeId) =>
                  recordPrototypeIntroduction(transaction, userId, prototypeId),
              })
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
          ),
      }),
    findRepositoryAuthors: (viewer, repositoryId, filters) =>
      readScoped(viewer, (repositoryScope) =>
        findRepositoryAuthors(prisma, repositoryId, filters, repositoryScope),
      ),
    editPrototypeMetadata: async (input) => {
      const hostedTarget = await prisma.prototype.findFirst({
        where: {
          id: input.prototypeId,
          ...(input.listing ? {} : { registeredAt: null }),
          repository: {
            id: input.repositoryId,
            githubRepositoryId: { not: null },
            localPath: null,
          },
        },
        select: { branchName: true, registeredAt: true },
      })
      const initial = hostedTarget
        ? await restoreSession(prisma, prisma, input.sessionDigest)
        : null
      const listingPermission =
        hostedTarget && initial
          ? await getRepositoryPermissionEvidence(
              initial,
              input.repositoryId,
              hostedTarget.registeredAt ? undefined : hostedTarget.branchName,
            )
          : null
      return editPrototypeMetadata(input, {
        runTransaction: (operation) =>
          prisma.$transaction(
            async (transaction) => {
              const { revision } = await lockAuthority(transaction)
              // Keep these reads in this transaction so authority and prototype locks remain
              // held through the read-back.
              const joined = joinTransaction(transaction)
              return operation({
                restoreSession: (digest) => restoreSession(transaction, joined, digest),
                lockPrototype: async (repositoryId, prototypeId, viewer) => {
                  if (!(await repositoryIsVisible(transaction, repositoryId, viewer))) return null
                  const prototype = await lockEditablePrototype(
                    transaction,
                    repositoryId,
                    prototypeId,
                    input.listing,
                  )
                  if (
                    input.listing &&
                    prototype &&
                    !prototype.hosted &&
                    !(
                      prototype.local &&
                      viewer.sessionProvider === "local" &&
                      viewer.role === "ADMINISTRATOR"
                    )
                  )
                    return null
                  if (
                    prototype &&
                    prototype.hosted &&
                    (input.listing || !prototype.registeredAt) &&
                    (!listingPermission ||
                      !canWriteRepository(listingPermission.permission ?? "none") ||
                      listingPermission.accessRevision !== revision ||
                      hostedTarget?.branchName !== prototype.branchName ||
                      initial?.externalIdentityId !== viewer.externalIdentityId ||
                      initial?.role !== viewer.role)
                  ) {
                    throw new PrototypeMetadataError("not_found", "Prototype not found.")
                  }
                  if (prototype && !prototype.registeredAt) {
                    await recordRepositoryAudit(transaction, {
                      action: "prototype.registered",
                      actorMembershipId: viewer.membershipId,
                      repositoryId,
                      targetId: prototype.id,
                    })
                  }
                  return prototype
                },
                updatePrototype: async (id, data) => {
                  await updatePrototypeMetadata(transaction, id, data)
                  if (data.registeredAt) {
                    await recordAnalyticsEvent(transaction, {
                      repositoryId: input.repositoryId,
                      prototypeId: id,
                      eventName: "prototype_registered",
                    })
                  }
                },
                findDetail: async (repositoryId, prototypeId, viewer) =>
                  findPrototypeDetail(
                    joined,
                    repositoryId,
                    prototypeId,
                    undefined,
                    undefined,
                    await scope(viewer, transaction),
                    buildArtifactUrl,
                  ),
              })
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
          ),
      })
    },
    findBuildPreviewTarget: (repositoryId, prototypeId, buildNumber, target) =>
      findBuildPreviewTarget(prisma, { repositoryId, prototypeId, buildNumber, target }),
  }
}
