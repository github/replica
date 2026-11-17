import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"
import { classifyPrismaTransactionError } from "../../../integrations/prisma/classify-transaction-error/index.ts"
import { createReviewCommentRepository } from "../../../repositories/review-comments/create-review-comment-repository/index.ts"
import type { ReviewPersistenceFailure } from "../../../repositories/review-comments/types.ts"
import { runWithBoundedRetries } from "../../identity/run-with-bounded-retries/index.ts"
import { ReviewCommentError } from "../errors.ts"
import { parseReviewAnchor } from "../parse-review-anchor/index.ts"
import { parseReviewBody } from "../parse-review-body/index.ts"
import { serializeReviewThread } from "../serialize-review-thread/index.ts"
import type { ReviewCommentService } from "../types.ts"

function persistenceError(reason: ReviewPersistenceFailure): ReviewCommentError {
  switch (reason) {
    case "comment_forbidden":
      return new ReviewCommentError("forbidden", "Only the comment author may change it.")
    case "comment_deleted":
      return new ReviewCommentError("unprocessable", "Deleted review comments cannot be edited")
    case "thread_closed":
      return new ReviewCommentError(
        "unprocessable",
        "Resolved review threads must be reopened before replying",
      )
    case "thread_deleted":
      return new ReviewCommentError(
        "unprocessable",
        "Deleted review threads cannot receive replies",
      )
    case "conflict":
      return new ReviewCommentError("conflict", "The review thread changed. Try again.")
    case "build_not_found":
      return new ReviewCommentError("not_found", "Successful Build not found.")
    case "comment_not_found":
      return new ReviewCommentError("not_found", "Review comment not found.")
    case "prototype_not_found":
      return new ReviewCommentError("not_found", "Reviewable prototype not found.")
    case "repository_not_found":
      return new ReviewCommentError("not_found", "Repository not found.")
    case "session_invalid":
      return new ReviewCommentError("unauthorized", "Sign in to continue.")
    case "thread_not_found":
      return new ReviewCommentError("not_found", "Review thread not found.")
  }
}

async function runReviewMutation<Result>(operation: () => Promise<Result>): Promise<Result> {
  try {
    return await runWithBoundedRetries(
      () => operation(),
      (error) => classifyPrismaTransactionError(error) === "retryable",
    )
  } catch (error) {
    if (classifyPrismaTransactionError(error) === "retryable") {
      throw new ReviewCommentError("conflict", "The review thread changed. Try again.")
    }
    throw error
  }
}

export function createReviewCommentService(
  database: Pick<PrismaClient, "$transaction" | "repository">,
  authorizeMutation: (
    transaction: Prisma.TransactionClient,
    sessionDigest: string,
    userId: string,
  ) => Promise<boolean> = () => Promise.resolve(true),
  options: {
    onDeleted?: (input: {
      repositoryId: string
      commentId: number
      actorLogin: string
    }) => Promise<void>
    withDeleteLock?: <T>(operation: () => Promise<T>) => Promise<T>
  } = {},
): ReviewCommentService {
  const repository = createReviewCommentRepository(database)
  return {
    async listPrototypeThreads(repositoryId, prototypeId) {
      const result = await repository.listPrototypeThreads(repositoryId, prototypeId)
      if (!result.ok) throw persistenceError(result.reason)
      return result.value.map(serializeReviewThread)
    },
    async createThread(input) {
      const body = parseReviewBody(input.body)
      const anchor = parseReviewAnchor(input.anchor) as unknown as Prisma.InputJsonValue
      const result = await runReviewMutation(() =>
        repository.createThread({
          ...input,
          body,
          anchor,
          authorize: (transaction) =>
            authorizeMutation(transaction, input.sessionDigest, input.actor.userId),
        }),
      )
      if (!result.ok) throw persistenceError(result.reason)
      return serializeReviewThread(result.value)
    },
    async createReply(input) {
      const body = parseReviewBody(input.body)
      const result = await runReviewMutation(() =>
        repository.createReply({
          ...input,
          body,
          authorize: (transaction) =>
            authorizeMutation(transaction, input.sessionDigest, input.actor.userId),
        }),
      )
      if (!result.ok) throw persistenceError(result.reason)
      return serializeReviewThread(result.value)
    },
    async editComment(input) {
      const body = parseReviewBody(input.body)
      const result = await runReviewMutation(() =>
        repository.editComment({
          ...input,
          body,
          authorize: (transaction) =>
            authorizeMutation(transaction, input.sessionDigest, input.actor.userId),
        }),
      )
      if (!result.ok) throw persistenceError(result.reason)
      return serializeReviewThread(result.value)
    },
    async deleteComment(input) {
      function operation() {
        return runReviewMutation(() =>
          repository.deleteComment({
            ...input,
            authorize: (transaction) =>
              authorizeMutation(transaction, input.sessionDigest, input.actor.userId),
          }),
        )
      }
      let result
      try {
        result = options.withDeleteLock
          ? await options.withDeleteLock(operation)
          : await operation()
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Another learning operation is still running."
        ) {
          throw new ReviewCommentError(
            "conflict",
            "A learning operation is using review comments. Try again.",
          )
        }
        throw error
      }
      if (!result.ok) throw persistenceError(result.reason)
      const thread = serializeReviewThread(result.value)
      await options.onDeleted?.({
        repositoryId: input.repositoryId,
        commentId: input.commentId,
        actorLogin: input.actor.login,
      })
      return thread
    },
    async setResolution(input) {
      const result = await runReviewMutation(() =>
        repository.setResolution({
          ...input,
          authorize: (transaction) =>
            authorizeMutation(transaction, input.sessionDigest, input.actor.userId),
        }),
      )
      if (!result.ok) throw persistenceError(result.reason)
      return serializeReviewThread(result.value)
    },
  }
}
