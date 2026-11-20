import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"
import {
  collaborationInclude,
  eligibleReviewPrototype,
  markReviewThreadRead,
} from "../collaboration-queries/index.ts"
import type { CollaborationThread } from "../collaboration-queries/index.ts"
import type { ReviewPersistenceFailure, ReviewPersistenceResult } from "../types.ts"

type Database = Pick<PrismaClient, "$transaction" | "repository">
type Transaction = Prisma.TransactionClient
type Repository = { id: string; defaultBranch: string }

export interface ReviewActivity {
  threadId: string
  commentId: string
  sourceId: string
  kind: "comment" | "reply" | "edited" | "deleted" | "resolved" | "reopened" | "reaction"
  content?: string
}

interface Mutation {
  repositoryId: string
  prototypeId: string
  actor: { userId: string; login: string; name: string | null }
  authorize: (transaction: Transaction) => Promise<boolean>
  record: (transaction: Transaction, activity: ReviewActivity) => Promise<void>
}

type Change = { id: string; version: number | null }
type Result<T> = ReviewPersistenceResult<T>

function failure(reason: ReviewPersistenceFailure) {
  return { ok: false as const, reason }
}

function success<T>(value: T) {
  return { ok: true as const, value }
}

function scope(input: Mutation, repository: Repository): Prisma.ReviewThreadWhereInput {
  return {
    repositoryId: repository.id,
    prototypeId: input.prototypeId,
    repository: { removedAt: null },
    prototype: eligibleReviewPrototype(repository, input.prototypeId),
  }
}

function authorFields(actor: Mutation["actor"]) {
  return { authorId: actor.userId, authorLogin: actor.login, authorName: actor.name }
}

function findRoot(
  transaction: Transaction,
  input: Mutation & { threadId: number },
  repository: Repository,
) {
  return transaction.reviewComment.findFirst({
    where: { rootId: null, publicId: input.threadId, thread: scope(input, repository) },
    include: { thread: true },
  })
}

function findMessage(
  transaction: Transaction,
  input: Mutation & { commentId: number },
  repository: Repository,
) {
  return transaction.reviewComment.findFirst({
    where: { publicId: input.commentId, thread: scope(input, repository) },
    include: { thread: true },
  })
}

async function advanceThread(
  transaction: Transaction,
  thread: { id: string; collaborationVersion: number },
  data: Prisma.ReviewThreadUncheckedUpdateManyInput = {},
) {
  const updated = await transaction.reviewThread.updateMany({
    where: { id: thread.id, collaborationVersion: thread.collaborationVersion },
    data: {
      activityVersion: { increment: 1 },
      ...data,
      collaborationVersion: { increment: 1 },
    },
  })
  return updated.count === 1
}

export function createReviewCommentRepository(database: Database) {
  function mutate(
    input: Mutation,
    change: (transaction: Transaction, repository: Repository) => Promise<Result<Change>>,
  ): Promise<Result<CollaborationThread>> {
    return database.$transaction(
      async (transaction) => {
        if (!(await input.authorize(transaction))) return failure("session_invalid")
        const repository = await transaction.repository.findFirst({
          where: { id: input.repositoryId, removedAt: null },
          select: { id: true, defaultBranch: true },
        })
        if (!repository) return failure("repository_not_found")
        const result = await change(transaction, repository)
        if (!result.ok) return result
        const { id, version } = result.value
        await markReviewThreadRead(transaction, id, input.actor.userId, version)
        return success(
          await transaction.reviewThread.findUniqueOrThrow({
            where: { id },
            include: collaborationInclude(input.actor.userId),
          }),
        )
      },
      { isolationLevel: "Serializable" },
    )
  }

  return {
    async listPrototypeThreads(
      repositoryId: string,
      prototypeId: string,
      viewerId: string,
    ): Promise<Result<CollaborationThread[]>> {
      const result = await database.$transaction(
        async (transaction) => {
          const repository = await transaction.repository.findFirst({
            where: { id: repositoryId, removedAt: null },
            select: { id: true, defaultBranch: true },
          })
          if (!repository) return failure("repository_not_found")
          const prototype = await transaction.prototype.findFirst({
            where: eligibleReviewPrototype(repository, prototypeId),
            select: { id: true },
          })
          if (!prototype) return failure("prototype_not_found")
          const threads = await transaction.reviewThread.findMany({
            where: { repositoryId, prototypeId },
            include: collaborationInclude(viewerId),
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          })
          return success({ repository, threads })
        },
        { isolationLevel: "RepeatableRead" },
      )
      if (!result.ok) return result
      const repository = await database.repository.findFirst({
        where: {
          id: repositoryId,
          removedAt: null,
          defaultBranch: result.value.repository.defaultBranch,
          prototypes: { some: eligibleReviewPrototype(result.value.repository, prototypeId) },
        },
        select: { id: true },
      })
      return repository ? success(result.value.threads) : failure("repository_not_found")
    },

    createThread(
      input: Mutation & { buildNumber: number; body: string; anchor: Prisma.InputJsonValue },
    ) {
      return mutate(input, async (transaction, repository) => {
        const prototype = await transaction.prototype.findFirst({
          where: eligibleReviewPrototype(repository, input.prototypeId),
          select: { id: true },
        })
        if (!prototype) return failure("prototype_not_found")
        const build = await transaction.build.findFirst({
          where: { prototypeId: input.prototypeId, number: input.buildNumber, state: "successful" },
          select: { id: true },
        })
        if (!build) return failure("build_not_found")
        const thread = await transaction.reviewThread.create({
          data: {
            repositoryId: repository.id,
            prototypeId: prototype.id,
            buildId: build.id,
            anchor: input.anchor,
          },
        })
        const comment = await transaction.reviewComment.create({
          data: { threadId: thread.id, ...authorFields(input.actor), body: input.body },
        })
        await input.record(transaction, {
          kind: "comment",
          threadId: thread.id,
          commentId: comment.id,
          sourceId: comment.id,
        })
        return success({ id: thread.id, version: thread.collaborationVersion })
      })
    },

    createReply(input: Mutation & { threadId: number; body: string }) {
      return mutate(input, async (transaction, repository) => {
        const root = await findRoot(transaction, input, repository)
        if (!root) return failure("thread_not_found")
        if (root.deletedAt) return failure("thread_deleted")
        if (root.thread.resolvedAt) return failure("thread_closed")
        if (!(await advanceThread(transaction, root.thread))) return failure("conflict")
        const comment = await transaction.reviewComment.create({
          data: {
            threadId: root.threadId,
            rootId: root.id,
            ...authorFields(input.actor),
            body: input.body,
          },
        })
        await input.record(transaction, {
          kind: "reply",
          threadId: root.threadId,
          commentId: comment.id,
          sourceId: comment.id,
        })
        return success({ id: root.threadId, version: root.thread.collaborationVersion + 1 })
      })
    },

    editComment(input: Mutation & { commentId: number; body: string; expectedBody?: string }) {
      return mutate(input, async (transaction, repository) => {
        const comment = await findMessage(transaction, input, repository)
        if (!comment) return failure("comment_not_found")
        if (comment.authorId !== input.actor.userId) return failure("comment_forbidden")
        if (comment.deletedAt) return failure("comment_deleted")
        if (input.expectedBody !== undefined && comment.body !== input.expectedBody) {
          return failure("conflict")
        }
        let version = comment.thread.collaborationVersion
        if (comment.body !== input.body) {
          if (!(await advanceThread(transaction, comment.thread))) return failure("conflict")
          version += 1
          await transaction.reviewComment.update({
            where: { id: comment.id },
            data: { body: input.body, editedAt: new Date() },
          })
          await input.record(transaction, {
            kind: "edited",
            threadId: comment.threadId,
            commentId: comment.id,
            sourceId: comment.id,
          })
        }
        return success({ id: comment.threadId, version })
      })
    },

    deleteComment(input: Mutation & { commentId: number }) {
      return mutate(input, async (transaction, repository) => {
        const comment = await findMessage(transaction, input, repository)
        if (!comment) return failure("comment_not_found")
        if (comment.authorId !== input.actor.userId) return failure("comment_forbidden")
        let version = comment.thread.collaborationVersion
        if (!comment.deletedAt) {
          if (!(await advanceThread(transaction, comment.thread))) return failure("conflict")
          version += 1
          await transaction.reviewComment.update({
            where: { id: comment.id },
            data: {
              deletedAt: new Date(),
              learningRedactionActor: `human:${input.actor.login}`,
              learningRedactedAt: null,
            },
          })
          await input.record(transaction, {
            kind: "deleted",
            threadId: comment.threadId,
            commentId: comment.id,
            sourceId: comment.id,
          })
        }
        return success({ id: comment.threadId, version })
      })
    },

    setResolution(input: Mutation & { threadId: number; resolved: boolean }) {
      return mutate(input, async (transaction, repository) => {
        const root = await findRoot(transaction, input, repository)
        if (!root) return failure("thread_not_found")
        if (root.deletedAt) return failure("thread_deleted")
        let version = root.thread.collaborationVersion
        if (input.resolved !== Boolean(root.thread.resolvedAt)) {
          const occurredAt = new Date()
          const changed = await advanceThread(transaction, root.thread, {
            resolvedAt: input.resolved ? occurredAt : null,
            resolvedById: input.resolved ? input.actor.userId : null,
          })
          if (!changed) return failure("conflict")
          version += 1
          const transition = await transaction.reviewThreadResolutionEvent.create({
            data: {
              threadId: root.threadId,
              actorId: input.actor.userId,
              actorLogin: input.actor.login,
              actorName: input.actor.name,
              sequence: root.thread.activityVersion + 1,
              state: input.resolved ? "RESOLVED" : "REOPENED",
              occurredAt,
            },
          })
          await input.record(transaction, {
            kind: input.resolved ? "resolved" : "reopened",
            threadId: root.threadId,
            commentId: root.id,
            sourceId: transition.id,
          })
        }
        return success({ id: root.threadId, version })
      })
    },

    setReaction(
      input: Mutation & {
        commentId: number
        activityVersion: number
        add: boolean
        content: string
      },
    ) {
      return mutate(input, async (transaction, repository) => {
        const comment = await findMessage(transaction, input, repository)
        if (!comment) return failure("comment_not_found")
        if (comment.deletedAt) return failure("comment_deleted")
        const key = { commentId: comment.id, userId: input.actor.userId, content: input.content }
        const existing = await transaction.reviewReaction.findUnique({
          where: { commentId_userId_content: key },
          select: { id: true },
        })
        let version = comment.thread.collaborationVersion
        if (input.add === Boolean(existing)) return success({ id: comment.threadId, version })
        // Reactions change review activity without changing the source snapshot.
        if (
          version !== input.activityVersion ||
          !(await advanceThread(transaction, comment.thread, {
            activityVersion: comment.thread.activityVersion,
            updatedAt: comment.thread.updatedAt,
          }))
        ) {
          return failure("conflict")
        }
        version += 1
        if (existing) {
          await transaction.reviewReaction.delete({ where: { id: existing.id } })
        } else {
          const reaction = await transaction.reviewReaction.create({ data: key })
          await input.record(transaction, {
            kind: "reaction",
            content: input.content,
            threadId: comment.threadId,
            commentId: comment.id,
            sourceId: reaction.id,
          })
        }
        return success({ id: comment.threadId, version })
      })
    },

    markThreadRead(input: Mutation & { threadId: number; activityVersion: number | null }) {
      return mutate(input, async (transaction, repository) => {
        const root = await findRoot(transaction, input, repository)
        if (!root) return failure("thread_not_found")
        if (
          input.activityVersion !== null &&
          input.activityVersion > root.thread.collaborationVersion
        ) {
          return failure("conflict")
        }
        return success({ id: root.threadId, version: input.activityVersion })
      })
    },
  }
}
