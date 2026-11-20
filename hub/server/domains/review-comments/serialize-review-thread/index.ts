import { parseReviewAnchor } from "../parse-review-anchor/index.ts"
import { createReviewFeedbackDigest } from "../create-review-feedback-digest/index.ts"
import type { ReviewActor, ReviewMessage, ReviewThread } from "../types.ts"
import type { StoredReviewThread } from "../../../repositories/review-comments/types.ts"

export function serializeReviewThread(thread: StoredReviewThread): ReviewThread {
  const storedRoot = thread.comments.find((comment) => comment.rootId === null)
  if (!storedRoot) throw new Error(`Review thread ${thread.id} has no root comment.`)
  const comments = thread.comments.map((comment): ReviewMessage => ({
    id: comment.publicId,
    storageId: comment.id,
    rootId: comment.rootId === null ? null : storedRoot.publicId,
    body: comment.deletedAt ? null : comment.body,
    author: {
      userId: comment.authorId,
      login: comment.authorLogin,
      name: comment.authorName,
    },
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    editedAt: comment.editedAt,
    deletedAt: comment.deletedAt,
  }))
  const root = comments.find((comment) => comment.rootId === null)
  if (!root) throw new Error(`Review thread ${thread.id} has no root comment.`)
  const resolutionHistory = thread.resolutionEvents.map((event) => ({
    id: event.id,
    sequence: event.sequence,
    state: event.state === "RESOLVED" ? ("resolved" as const) : ("reopened" as const),
    actor: {
      userId: event.actorId,
      login: event.actorLogin,
      name: event.actorName,
    },
    occurredAt: event.occurredAt,
  }))
  const latestResolution = resolutionHistory.at(-1)
  const feedbackDigest = createReviewFeedbackDigest(storedRoot)
  const resolvedBy: ReviewActor | null =
    thread.resolvedAt && latestResolution?.state === "resolved" ? latestResolution.actor : null

  return {
    id: root.id,
    storageId: thread.id,
    repositoryId: thread.repositoryId,
    prototype: {
      id: thread.prototype.id,
      name: thread.prototype.name,
      branch: thread.prototype.branchName,
    },
    buildNumber: thread.build.number,
    anchor: parseReviewAnchor(thread.anchor),
    activityVersion: thread.activityVersion,
    resolvedAt: thread.resolvedAt,
    resolvedBy,
    root,
    replies: comments.filter((comment) => comment.rootId !== null),
    feedbackDigest,
    resolutionHistory,
    outcomeHistory: thread.outcomes.map((outcome) => {
      const staleReason =
        outcome.build.state !== "successful"
          ? ("build_unavailable" as const)
          : outcome.feedbackDigest !== feedbackDigest
            ? ("feedback_changed" as const)
            : latestResolution?.id !== outcome.resolutionEventId
              ? thread.resolvedAt
                ? ("resolution_changed" as const)
                : ("thread_reopened" as const)
              : null
      return {
        id: outcome.id,
        sequence: outcome.sequence,
        kind:
          outcome.kind === "CONFIRMED_FIXED"
            ? ("confirmed_fixed" as const)
            : outcome.kind === "STILL_PRESENT"
              ? ("still_present" as const)
              : outcome.kind === "NOT_APPLICABLE"
                ? ("not_applicable" as const)
                : ("needs_more_review" as const),
        buildNumber: outcome.build.number,
        feedbackDigest: outcome.feedbackDigest,
        resolutionEventId: outcome.resolutionEventId,
        verifier: {
          userId: outcome.verifierId,
          login: outcome.verifierLogin,
          name: outcome.verifierName,
        },
        verifiedAt: outcome.verifiedAt,
        stale: staleReason !== null,
        staleReason,
      }
    }),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  }
}
