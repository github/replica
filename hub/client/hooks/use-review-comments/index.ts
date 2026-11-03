import { useRef, useState } from "react"

import type { ReviewAnchor } from "@utils/review-anchor/types"
import type {
  ReviewComment,
  ReviewReactionContent,
  ReviewRootComment,
} from "@utils/review-comment/types"

import type { ReviewCommentMutation, ReviewCommentsState } from "./types"
import { useReviewCommentsClient } from "./use-review-comments-client"
import { useReviewCommentsState } from "./use-review-comments-state"
import type { ReviewCommentsTransport } from "./use-review-comments-client/types"

/** Returns the current root activity version for a root or reply. */
function threadActivityVersion(commentId: number, comments: ReviewComment[]) {
  const comment = comments.find(({ id }) => id === commentId)
  if (!comment) return null
  if (comment.kind === "root") return comment.activityVersion

  const root = comments.find(({ id }) => id === comment.rootId)
  return root?.kind === "root" ? root.activityVersion : null
}

/** Loads review data and sends authorized comment changes. */
export function useReviewComments(
  path: string,
  authenticityToken: string,
  transport?: ReviewCommentsTransport,
): ReviewCommentsState {
  const [mutation, setMutation] = useState<ReviewCommentMutation | null>(null)
  const mutationRef = useRef<ReviewCommentMutation | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const reviewState = useReviewCommentsState()
  const reviewClient = useReviewCommentsClient({
    authenticityToken,
    path,
    onCommentsChanged: reviewState.mergeChangedComments,
    onCommentsLoadFailed: reviewState.markCommentsLoadFailed,
    onCommentsLoaded: reviewState.replaceFullyLoadedComments,
    onRefreshStarted: reviewState.startRefreshingComments,
    onReset: reviewState.resetComments,
    onReviewAccessLost: reviewState.clearCommentsAfterAccessLoss,
    onMutationRateLimited: setMutationError,
    transport,
  })

  async function saveComment(
    requestPath: string,
    method: "POST" | "PATCH" | "DELETE",
    nextMutation: ReviewCommentMutation,
    body?: object,
  ) {
    if (mutationRef.current) return null

    mutationRef.current = nextMutation
    setMutation(nextMutation)
    setMutationError(null)
    try {
      return await reviewClient.sendCommentChange(requestPath, method, body)
    } catch {
      return null
    } finally {
      if (mutationRef.current === nextMutation) {
        mutationRef.current = null
        setMutation(null)
      }
    }
  }

  function createComment(buildNumber: number, body: string, anchor: ReviewAnchor) {
    return saveComment(
      path,
      "POST",
      { kind: "create" },
      {
        review_comment: { build_number: buildNumber, body, anchor },
      },
    )
  }

  function createReply(rootId: number, body: string) {
    return saveComment(
      `${path}/${rootId}/replies`,
      "POST",
      { kind: "reply", commentId: rootId },
      { review_comment: { body } },
    )
  }

  function editComment(commentId: number, body: string) {
    return saveComment(
      `${path}/${commentId}`,
      "PATCH",
      { kind: "edit", commentId },
      {
        review_comment: { body },
      },
    )
  }

  function deleteComment(commentId: number) {
    return saveComment(`${path}/${commentId}`, "DELETE", { kind: "delete", commentId })
  }

  function resolveThread(rootId: number) {
    return saveComment(`${path}/${rootId}/resolution`, "POST", {
      kind: "resolve",
      commentId: rootId,
    })
  }

  function reopenThread(rootId: number) {
    return saveComment(`${path}/${rootId}/resolution`, "DELETE", {
      kind: "reopen",
      commentId: rootId,
    })
  }

  async function addReaction(commentId: number, content: ReviewReactionContent) {
    const activityVersion = threadActivityVersion(commentId, reviewState.comments)
    if (activityVersion === null) return null

    return saveComment(
      `${path}/${commentId}/reactions`,
      "POST",
      { kind: "add-reaction", commentId, content },
      { review_comment_reaction: { content, activity_version: activityVersion } },
    )
  }

  async function removeReaction(commentId: number, content: ReviewReactionContent) {
    const activityVersion = threadActivityVersion(commentId, reviewState.comments)
    if (activityVersion === null) return null

    return saveComment(
      `${path}/${commentId}/reactions/${content}`,
      "DELETE",
      {
        kind: "remove-reaction",
        commentId,
        content,
      },
      { review_comment_reaction: { activity_version: activityVersion } },
    )
  }

  async function markThreadRead(
    rootId: number,
    activityVersion: number,
  ): Promise<ReviewRootComment | null> {
    const root = await reviewClient.sendCommentChange(`${path}/${rootId}/read`, "POST", {
      review_thread_read: { activity_version: activityVersion },
    })
    return root?.kind === "root" ? root : null
  }

  async function markThreadUnread(rootId: number): Promise<ReviewRootComment | null> {
    const root = await saveComment(`${path}/${rootId}/read`, "DELETE", {
      kind: "mark-unread",
      commentId: rootId,
    })
    return root?.kind === "root" ? root : null
  }

  return {
    comments: reviewState.comments,
    loading: reviewState.loading,
    loadFailed: reviewState.loadFailed,
    mutation,
    mutationError,
    refreshComments: reviewClient.refreshComments,
    createComment,
    createReply,
    editComment,
    deleteComment,
    resolveThread,
    reopenThread,
    addReaction,
    removeReaction,
    markThreadRead,
    markThreadUnread,
  }
}
