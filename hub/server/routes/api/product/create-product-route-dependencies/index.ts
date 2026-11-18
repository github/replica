import { Prisma } from "../../../../generated/prisma/client.ts"
import { restoreHubSession } from "../../../../domains/admission/restore-hub-session/index.ts"
import { runSessionRestoreTransaction } from "../../../../domains/admission/run-session-restore-transaction/index.ts"
import { editPrototypeMetadata } from "../../../../domains/prototypes/edit-prototype-metadata/index.ts"
import { readPrototypeWithIntroduction } from "../../../../domains/prototypes/read-prototype-with-introduction/index.ts"
import { createReviewCommentService } from "../../../../domains/review-comments/create-review-comment-service/index.ts"
import { ReviewCommentError } from "../../../../domains/review-comments/errors.ts"
import { prisma } from "../../../../integrations/prisma/index.ts"
import { lockAuthenticationProvidersForPrototypeEdit } from "../../../../repositories/authentication-providers/lock-authentication-providers-for-prototype-edit/index.ts"
import { lockGitHubRepositoryAccessState } from "../../../../repositories/github-repository-access-states/lock-github-repository-access-state/index.ts"
import { findRepositoryAuthors } from "../../../../repositories/prototype-index/find-repository-authors/index.ts"
import { findRepositoryIndex } from "../../../../repositories/prototype-index/find-repository-index/index.ts"
import { findPrototypeDetail } from "../../../../repositories/prototype-index/find-prototype-detail/index.ts"
import { listRepositories } from "../../../../repositories/prototype-index/list-repositories/index.ts"
import { visibleRepositoryWhere } from "../../../../repositories/prototype-index/visible-repository-where/index.ts"
import { recordPrototypeIntroduction } from "../../../../repositories/prototype-introductions/record-prototype-introduction/index.ts"
import { lockEditablePrototype } from "../../../../repositories/prototypes/lock-editable-prototype/index.ts"
import { lockVisiblePrototype } from "../../../../repositories/prototypes/lock-visible-prototype/index.ts"
import { updatePrototypeMetadata } from "../../../../repositories/prototypes/update-prototype-metadata/index.ts"
import { lockSessionRevocationState } from "../../../../repositories/session-revocation-states/lock-session-revocation-state/index.ts"
import { findCurrentSessionProfile } from "../../../../repositories/user-profiles/find-current-session-profile/index.ts"
import { readWithPersistedRepositoryScope } from "../read-with-persisted-repository-scope/index.ts"
import { resolvePersistedRepositoryScope } from "../resolve-persisted-repository-scope/index.ts"
import type { resolveRepositoryScope } from "../resolve-repository-scope/index.ts"
import type { RepositoryScope } from "../../../../repositories/prototype-index/visible-repository-where/index.ts"
import type { ProductRouteDependencies } from "../types.ts"

interface CreateProductRouteDependenciesOptions {
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
  withReviewCommentDeleteLock?: <T>(operation: () => Promise<T>) => Promise<T>
}

export function createProductRouteDependencies({
  scopeGitHubMembers = false,
  authorizeReviewMutation,
  onReviewCommentDeleted,
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
    await lockGitHubRepositoryAccessState(transaction)
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
  return {
    reviewComments: createReviewCommentService(prisma, authorizeReview, {
      onDeleted: onReviewCommentDeleted,
      withDeleteLock: withReviewCommentDeleteLock,
    }),
    isRepositoryVisible: (viewer, repositoryId) =>
      repositoryIsVisible(prisma, repositoryId, viewer),
    listRepositories: (viewer) =>
      readScoped(viewer, (repositoryScope) => listRepositories(prisma, repositoryScope)),
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
    editPrototypeMetadata: (input) =>
      editPrototypeMetadata(input, {
        runTransaction: (operation) =>
          prisma.$transaction(
            async (transaction) => {
              await lockAuthority(transaction)
              // Keep these reads in this transaction so authority and prototype locks remain
              // held through the read-back.
              const joined = joinTransaction(transaction)
              return operation({
                restoreSession: (digest) => restoreSession(transaction, joined, digest),
                lockPrototype: async (repositoryId, prototypeId, viewer) =>
                  (await repositoryIsVisible(transaction, repositoryId, viewer))
                    ? lockEditablePrototype(transaction, repositoryId, prototypeId)
                    : null,
                updatePrototype: (id, data) => updatePrototypeMetadata(transaction, id, data),
                findDetail: async (repositoryId, prototypeId, viewer) =>
                  findPrototypeDetail(
                    joined,
                    repositoryId,
                    prototypeId,
                    undefined,
                    undefined,
                    await scope(viewer, transaction),
                  ),
              })
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
          ),
      }),
  }
}
