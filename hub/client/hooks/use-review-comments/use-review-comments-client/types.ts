import type { ReviewComment } from "@utils/review-comment/types"
import type { ReviewCommentsFetchResult } from "./fetch-all-review-comments/types"

export type ReviewCommentChangeMethod = "POST" | "PATCH" | "DELETE"

export type ReviewCommentsChangeResult =
  { kind: "success"; comments: ReviewComment[] } | { kind: "access-lost" }

export interface ReviewCommentsTransport {
  load: (path: string, signal: AbortSignal) => Promise<ReviewCommentsFetchResult>
  change: (
    path: string,
    method: ReviewCommentChangeMethod,
    body?: object,
    signal?: AbortSignal,
  ) => Promise<ReviewCommentsChangeResult>
}

export interface ReviewCommentsClient {
  refreshComments: () => void
  sendCommentChange: (
    requestPath: string,
    method: ReviewCommentChangeMethod,
    body?: object,
  ) => Promise<ReviewComment | null>
}

export interface ReviewCommentsClientOptions {
  authenticityToken: string
  path: string
  onCommentsChanged: (comments: ReviewComment[]) => void
  onCommentsLoadFailed: () => void
  onCommentsLoaded: (comments: ReviewComment[]) => void
  onRefreshStarted: () => void
  onReset: () => void
  onReviewAccessLost: () => void
  onMutationRateLimited?: (message: string) => void
  transport?: ReviewCommentsTransport
}
