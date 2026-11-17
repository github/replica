import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"
import { reviewThreadInclude } from "../types.ts"
import type { ReviewPersistenceResult, StoredReviewThread } from "../types.ts"

type Database = Pick<PrismaClient, "$transaction" | "repository">

interface Actor {
  userId: string
  login: string
  name: string | null
}

type AuthorizeMutation = (transaction: Prisma.TransactionClient) => Promise<boolean>

function reviewablePrototypeWhere(
  repositoryId: string,
  prototypeId: string,
  defaultBranch: string,
): Prisma.PrototypeWhereInput {
  return {
    id: prototypeId,
    repositoryId,
    registeredAt: { not: null },
    branchDeletedAt: null,
    replica: false,
    branchName: { notIn: [defaultBranch, "replica/install-workflow"] },
  }
}

async function findStoredThread(
  transaction: Prisma.TransactionClient,
  repositoryId: string,
  prototypeId: string,
  threadId: string,
  defaultBranch: string,
) {
  return transaction.reviewThread.findFirst({
    where: {
      id: threadId,
      repositoryId,
      prototypeId,
      repository: { removedAt: null },
      prototype: reviewablePrototypeWhere(repositoryId, prototypeId, defaultBranch),
    },
    include: reviewThreadInclude,
  })
}

async function findStoredThreadByPublicId(
  transaction: Prisma.TransactionClient,
  repositoryId: string,
  prototypeId: string,
  threadId: number,
  defaultBranch: string,
) {
  return transaction.reviewThread.findFirst({
    where: {
      repositoryId,
      prototypeId,
      repository: { removedAt: null },
      prototype: reviewablePrototypeWhere(repositoryId, prototypeId, defaultBranch),
      comments: { some: { publicId: threadId, rootId: null } },
    },
    include: reviewThreadInclude,
  })
}

export function createReviewCommentRepository(database: Database) {
  return {
    async listPrototypeThreads(
      repositoryId: string,
      prototypeId: string,
    ): Promise<ReviewPersistenceResult<StoredReviewThread[]>> {
      const result: ReviewPersistenceResult<{
        defaultBranch: string
        threads: StoredReviewThread[]
      }> = await database.$transaction(
        async (transaction) => {
          const repository = await transaction.repository.findFirst({
            where: { id: repositoryId, removedAt: null },
            select: { defaultBranch: true },
          })
          if (!repository) return { ok: false, reason: "repository_not_found" }
          const prototype = await transaction.prototype.findFirst({
            where: {
              id: prototypeId,
              repositoryId,
              registeredAt: { not: null },
              branchDeletedAt: null,
              replica: false,
              branchName: { notIn: [repository.defaultBranch, "replica/install-workflow"] },
            },
            select: { id: true },
          })
          if (!prototype) return { ok: false, reason: "prototype_not_found" }
          const threads = await transaction.reviewThread.findMany({
            where: { repositoryId, prototypeId },
            include: reviewThreadInclude,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          })
          return {
            ok: true,
            value: { defaultBranch: repository.defaultBranch, threads },
          }
        },
        { isolationLevel: "RepeatableRead" },
      )
      if (!result.ok) return result
      const repository = await database.repository.findFirst({
        where: {
          id: repositoryId,
          removedAt: null,
          defaultBranch: result.value.defaultBranch,
          prototypes: {
            some: reviewablePrototypeWhere(repositoryId, prototypeId, result.value.defaultBranch),
          },
        },
        select: { id: true },
      })
      return repository
        ? { ok: true, value: result.value.threads }
        : { ok: false, reason: "repository_not_found" }
    },

    async createThread(input: {
      repositoryId: string
      prototypeId: string
      buildNumber: number
      body: string
      anchor: Prisma.InputJsonValue
      actor: Actor
      authorize: AuthorizeMutation
    }): Promise<ReviewPersistenceResult<StoredReviewThread>> {
      return database.$transaction(
        async (transaction) => {
          if (!(await input.authorize(transaction))) {
            return { ok: false, reason: "session_invalid" }
          }
          const repository = await transaction.repository.findFirst({
            where: { id: input.repositoryId, removedAt: null },
            select: { defaultBranch: true },
          })
          if (!repository) return { ok: false, reason: "repository_not_found" }
          const prototype = await transaction.prototype.findFirst({
            where: {
              id: input.prototypeId,
              repositoryId: input.repositoryId,
              registeredAt: { not: null },
              branchDeletedAt: null,
              replica: false,
              branchName: { notIn: [repository.defaultBranch, "replica/install-workflow"] },
            },
            select: { id: true },
          })
          if (!prototype) return { ok: false, reason: "prototype_not_found" }
          const build = await transaction.build.findFirst({
            where: {
              prototypeId: input.prototypeId,
              number: input.buildNumber,
              state: "successful",
            },
            select: { id: true },
          })
          if (!build) return { ok: false, reason: "build_not_found" }

          const thread = await transaction.reviewThread.create({
            data: {
              repositoryId: input.repositoryId,
              prototypeId: input.prototypeId,
              buildId: build.id,
              anchor: input.anchor,
              comments: {
                create: {
                  authorId: input.actor.userId,
                  authorLogin: input.actor.login,
                  authorName: input.actor.name,
                  body: input.body,
                },
              },
            },
            include: reviewThreadInclude,
          })
          return { ok: true, value: thread }
        },
        { isolationLevel: "Serializable" },
      )
    },

    async createReply(input: {
      repositoryId: string
      prototypeId: string
      threadId: number
      body: string
      actor: Actor
      authorize: AuthorizeMutation
    }): Promise<ReviewPersistenceResult<StoredReviewThread>> {
      return database.$transaction(
        async (transaction) => {
          if (!(await input.authorize(transaction))) {
            return { ok: false, reason: "session_invalid" }
          }
          const repository = await transaction.repository.findFirst({
            where: { id: input.repositoryId, removedAt: null },
            select: { defaultBranch: true },
          })
          if (!repository) return { ok: false, reason: "repository_not_found" }
          const thread = await findStoredThreadByPublicId(
            transaction,
            input.repositoryId,
            input.prototypeId,
            input.threadId,
            repository.defaultBranch,
          )
          if (!thread) return { ok: false, reason: "thread_not_found" }
          const root = thread.comments.find((comment) => comment.rootId === null)
          if (!root) return { ok: false, reason: "thread_not_found" }
          if (root.deletedAt) return { ok: false, reason: "thread_deleted" }
          if (thread.resolvedAt) return { ok: false, reason: "thread_closed" }

          const changed = await transaction.reviewThread.updateMany({
            where: { id: thread.id, activityVersion: thread.activityVersion, resolvedAt: null },
            data: { activityVersion: { increment: 1 } },
          })
          if (changed.count !== 1) return { ok: false, reason: "conflict" }
          await transaction.reviewComment.create({
            data: {
              threadId: thread.id,
              rootId: root.id,
              authorId: input.actor.userId,
              authorLogin: input.actor.login,
              authorName: input.actor.name,
              body: input.body,
            },
          })
          const stored = await findStoredThread(
            transaction,
            input.repositoryId,
            input.prototypeId,
            thread.id,
            repository.defaultBranch,
          )
          return stored ? { ok: true, value: stored } : { ok: false, reason: "thread_not_found" }
        },
        { isolationLevel: "Serializable" },
      )
    },

    async editComment(input: {
      repositoryId: string
      prototypeId: string
      commentId: number
      body: string
      actor: Actor
      authorize: AuthorizeMutation
    }): Promise<ReviewPersistenceResult<StoredReviewThread>> {
      return database.$transaction(
        async (transaction) => {
          if (!(await input.authorize(transaction))) {
            return { ok: false, reason: "session_invalid" }
          }
          const repository = await transaction.repository.findFirst({
            where: { id: input.repositoryId, removedAt: null },
            select: { defaultBranch: true },
          })
          if (!repository) return { ok: false, reason: "repository_not_found" }
          const comment = await transaction.reviewComment.findFirst({
            where: {
              publicId: input.commentId,
              thread: {
                repositoryId: input.repositoryId,
                prototypeId: input.prototypeId,
                repository: { removedAt: null },
                prototype: reviewablePrototypeWhere(
                  input.repositoryId,
                  input.prototypeId,
                  repository.defaultBranch,
                ),
              },
            },
            select: {
              id: true,
              threadId: true,
              authorId: true,
              body: true,
              deletedAt: true,
              thread: { select: { activityVersion: true } },
            },
          })
          if (!comment) return { ok: false, reason: "comment_not_found" }
          if (comment.authorId !== input.actor.userId) {
            return { ok: false, reason: "comment_forbidden" }
          }
          if (comment.deletedAt) return { ok: false, reason: "comment_deleted" }
          if (comment.body !== input.body) {
            const changed = await transaction.reviewThread.updateMany({
              where: { id: comment.threadId, activityVersion: comment.thread.activityVersion },
              data: { activityVersion: { increment: 1 } },
            })
            if (changed.count !== 1) return { ok: false, reason: "conflict" }
            await transaction.reviewComment.update({
              where: { id: comment.id },
              data: { body: input.body, editedAt: new Date() },
            })
          }
          const stored = await findStoredThread(
            transaction,
            input.repositoryId,
            input.prototypeId,
            comment.threadId,
            repository.defaultBranch,
          )
          return stored ? { ok: true, value: stored } : { ok: false, reason: "thread_not_found" }
        },
        { isolationLevel: "Serializable" },
      )
    },

    async deleteComment(input: {
      repositoryId: string
      prototypeId: string
      commentId: number
      actor: Actor
      authorize: AuthorizeMutation
    }): Promise<ReviewPersistenceResult<StoredReviewThread>> {
      return database.$transaction(
        async (transaction) => {
          if (!(await input.authorize(transaction))) {
            return { ok: false, reason: "session_invalid" }
          }
          const repository = await transaction.repository.findFirst({
            where: { id: input.repositoryId, removedAt: null },
            select: { defaultBranch: true },
          })
          if (!repository) return { ok: false, reason: "repository_not_found" }
          const comment = await transaction.reviewComment.findFirst({
            where: {
              publicId: input.commentId,
              thread: {
                repositoryId: input.repositoryId,
                prototypeId: input.prototypeId,
                repository: { removedAt: null },
                prototype: reviewablePrototypeWhere(
                  input.repositoryId,
                  input.prototypeId,
                  repository.defaultBranch,
                ),
              },
            },
            select: {
              id: true,
              threadId: true,
              authorId: true,
              deletedAt: true,
              thread: { select: { activityVersion: true } },
            },
          })
          if (!comment) return { ok: false, reason: "comment_not_found" }
          if (comment.authorId !== input.actor.userId) {
            return { ok: false, reason: "comment_forbidden" }
          }
          if (!comment.deletedAt) {
            const changed = await transaction.reviewThread.updateMany({
              where: { id: comment.threadId, activityVersion: comment.thread.activityVersion },
              data: { activityVersion: { increment: 1 } },
            })
            if (changed.count !== 1) return { ok: false, reason: "conflict" }
            await transaction.reviewComment.update({
              where: { id: comment.id },
              data: {
                deletedAt: new Date(),
                learningRedactionActor: `human:${input.actor.login}`,
                learningRedactedAt: null,
              },
            })
          }
          const stored = await findStoredThread(
            transaction,
            input.repositoryId,
            input.prototypeId,
            comment.threadId,
            repository.defaultBranch,
          )
          return stored ? { ok: true, value: stored } : { ok: false, reason: "thread_not_found" }
        },
        { isolationLevel: "Serializable" },
      )
    },

    async setResolution(input: {
      repositoryId: string
      prototypeId: string
      threadId: number
      resolved: boolean
      actor: Actor
      authorize: AuthorizeMutation
    }): Promise<ReviewPersistenceResult<StoredReviewThread>> {
      return database.$transaction(
        async (transaction) => {
          if (!(await input.authorize(transaction))) {
            return { ok: false, reason: "session_invalid" }
          }
          const repository = await transaction.repository.findFirst({
            where: { id: input.repositoryId, removedAt: null },
            select: { defaultBranch: true },
          })
          if (!repository) return { ok: false, reason: "repository_not_found" }
          const thread = await findStoredThreadByPublicId(
            transaction,
            input.repositoryId,
            input.prototypeId,
            input.threadId,
            repository.defaultBranch,
          )
          if (!thread) return { ok: false, reason: "thread_not_found" }
          const alreadyDesired = input.resolved
            ? thread.resolvedAt !== null
            : thread.resolvedAt === null
          if (!alreadyDesired) {
            const occurredAt = new Date()
            const changed = await transaction.reviewThread.updateMany({
              where: {
                id: thread.id,
                activityVersion: thread.activityVersion,
                resolvedAt: input.resolved ? null : { not: null },
              },
              data: {
                activityVersion: { increment: 1 },
                resolvedAt: input.resolved ? occurredAt : null,
                resolvedById: input.resolved ? input.actor.userId : null,
              },
            })
            if (changed.count !== 1) return { ok: false, reason: "conflict" }
            await transaction.reviewThreadResolutionEvent.create({
              data: {
                threadId: thread.id,
                actorId: input.actor.userId,
                actorLogin: input.actor.login,
                actorName: input.actor.name,
                sequence: thread.activityVersion + 1,
                state: input.resolved ? "RESOLVED" : "REOPENED",
                occurredAt,
              },
            })
          }
          const stored = await findStoredThread(
            transaction,
            input.repositoryId,
            input.prototypeId,
            thread.id,
            repository.defaultBranch,
          )
          return stored ? { ok: true, value: stored } : { ok: false, reason: "thread_not_found" }
        },
        { isolationLevel: "Serializable" },
      )
    },
  }
}
