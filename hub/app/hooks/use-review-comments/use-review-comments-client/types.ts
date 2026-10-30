import type { ReviewComment } from "@utils/review-comment/types"

export type ReviewCommentChangeMethod = "POST" | "PATCH" | "DELETE"

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
}
