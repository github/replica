import { Prisma } from "../../../../generated/prisma/client.ts"
import { restoreHubSession } from "../../../../domains/admission/restore-hub-session/index.ts"
import { runSessionRestoreTransaction } from "../../../../domains/admission/run-session-restore-transaction/index.ts"
import { createBuildPreviewOrigin } from "../../../../domains/build-preview/create-build-preview-origin/index.ts"
import { editPrototypeMetadata } from "../../../../domains/prototypes/edit-prototype-metadata/index.ts"
import { PrototypeMetadataError } from "../../../../domains/prototypes/errors.ts"
import { readPrototypeWithIntroduction } from "../../../../domains/prototypes/read-prototype-with-introduction/index.ts"
import { authorizeRepositoryReview } from "../../../../domains/review-comments/authorize-repository-review/index.ts"
import { createReviewCommentService } from "../../../../domains/review-comments/create-review-comment-service/index.ts"
import { ReviewCommentError } from "../../../../domains/review-comments/errors.ts"
import { prisma } from "../../../../integrations/prisma/index.ts"
import { readRepositoryPermission } from "../../../../integrations/github/read-repository-permission/index.ts"
import type {
  RepositoryPermission,
  RepositoryPermissionInput,
} from "../../../../integrations/github/read-repository-permission/types.ts"
import { lockAuthenticationProvidersForPrototypeEdit } from "../../../../repositories/authentication-providers/lock-authentication-providers-for-prototype-edit/index.ts"
import { findBuildPreviewTarget } from "../../../../repositories/build-artifacts/find-build-preview-target/index.ts"
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
import { updatePrototypeMetadata } from "../../../../repositories/prototypes/update-prototype-metadata/index.ts"
import { recordRepositoryAudit } from "../../../../repositories/security-audits/record-repository-audit/index.ts"
import { lockSessionRevocationState } from "../../../../repositories/session-revocation-states/lock-session-revocation-state/index.ts"
import { findCurrentSessionProfile } from "../../../../repositories/user-profiles/find-current-session-profile/index.ts"
import { canWriteRepository } from "../../../../utils/can-write-repository/index.ts"
import { readWithPersistedRepositoryScope } from "../read-with-persisted-repository-scope/index.ts"
import { resolvePersistedRepositoryScope } from "../resolve-persisted-repository-scope/index.ts"
import type { resolveRepositoryScope } from "../resolve-repository-scope/index.ts"
import type { ProductRouteDependencies, ProductViewer } from "../types.ts"

interface CreateProductRouteDependenciesOptions {
  applicationOrigin?: string
  githubRepositoryCredentials?: RepositoryPermissionInput["credentials"]
  requestGitHub?: typeof fetch
  scopeGitHubMembers?: boolean
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
  withReviewCommentDeleteLock?: <T>(operation: () => Promise<T>) => Promise<T>
}

export function createProductRouteDependencies({
  applicationOrigin,
  githubRepositoryCredentials,
  requestGitHub,
  scopeGitHubMembers = false,
  authorizeReviewMutation,
  onReviewCommentDeleted,
  previewBaseOrigin,
  withReviewCommentDeleteLock,
}: CreateProductRouteDependenciesOptions = {}): ProductRouteDependencies {
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
    return profile ? { ...session, sessionProvider: profile.sessionProvider } : null
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
  ): Promise<{ permission: RepositoryPermission; accessRevision: number | null }> {
    const denied = { permission: "none", accessRevision: null } as const
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
    return (await getRepositoryPermissionEvidence(viewer, repositoryId)).permission
  }
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
      if (!(await repositoryIsVisible(transaction, repositoryId, restored))) {
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
  return {
    getRepositoryPermission,
    reviewComments: createReviewCommentService(prisma, authorizeReview, {
      onDeleted: onReviewCommentDeleted,
      withDeleteLock: withReviewCommentDeleteLock,
    }),
    authorizeReviewAccess: async (repositoryId, actor) =>
      authorizeRepositoryReview(actor, await findRepositoryReviewAccess(prisma, repositoryId)),
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
      const hostedDraft = await prisma.prototype.findFirst({
        where: {
          id: input.prototypeId,
          registeredAt: null,
          repository: {
            id: input.repositoryId,
            githubRepositoryId: { not: null },
            localPath: null,
          },
        },
        select: { branchName: true },
      })
      const initial = hostedDraft ? await restoreSession(prisma, prisma, input.sessionDigest) : null
      const registrationPermission =
        hostedDraft && initial
          ? await getRepositoryPermissionEvidence(
              initial,
              input.repositoryId,
              hostedDraft.branchName,
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
                  )
                  if (
                    prototype &&
                    !prototype.registeredAt &&
                    prototype.hosted &&
                    (!registrationPermission ||
                      !canWriteRepository(registrationPermission.permission) ||
                      registrationPermission.accessRevision !== revision ||
                      hostedDraft?.branchName !== prototype.branchName ||
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
                updatePrototype: (id, data) => updatePrototypeMetadata(transaction, id, data),
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
