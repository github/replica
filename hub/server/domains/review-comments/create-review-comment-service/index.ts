import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"
import { createReviewCommentRepository } from "../../../repositories/review-comments/create-review-comment-repository/index.ts"
import type { ReviewPersistenceFailure } from "../../../repositories/review-comments/types.ts"
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
    case "thread_not_found":
      return new ReviewCommentError("not_found", "Review thread not found.")
  }
}

export function createReviewCommentService(
  database: Pick<PrismaClient, "$transaction">,
): ReviewCommentService {
  const repository = createReviewCommentRepository(database)
  return {
    async listPrototypeThreads(repositoryId, prototypeId) {
      const result = await repository.listPrototypeThreads(repositoryId, prototypeId)
      if (!result.ok) throw persistenceError(result.reason)
      return result.value.map(serializeReviewThread)
    },
    async createThread(input) {
      const result = await repository.createThread({
        ...input,
        body: parseReviewBody(input.body),
        anchor: parseReviewAnchor(input.anchor) as unknown as Prisma.InputJsonValue,
      })
      if (!result.ok) throw persistenceError(result.reason)
      return serializeReviewThread(result.value)
    },
    async createReply(input) {
      const result = await repository.createReply({
        ...input,
        body: parseReviewBody(input.body),
      })
      if (!result.ok) throw persistenceError(result.reason)
      return serializeReviewThread(result.value)
    },
    async editComment(input) {
      const result = await repository.editComment({
        ...input,
        body: parseReviewBody(input.body),
      })
      if (!result.ok) throw persistenceError(result.reason)
      return serializeReviewThread(result.value)
    },
    async deleteComment(input) {
      const result = await repository.deleteComment(input)
      if (!result.ok) throw persistenceError(result.reason)
      return serializeReviewThread(result.value)
    },
    async setResolution(input) {
      const result = await repository.setResolution(input)
      if (!result.ok) throw persistenceError(result.reason)
      return serializeReviewThread(result.value)
    },
  }
}
