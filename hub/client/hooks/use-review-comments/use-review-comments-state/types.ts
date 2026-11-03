import type { ReviewComment } from "@utils/review-comment/types"

export interface ReviewCommentsStateResult {
  comments: ReviewComment[]
  loading: boolean
  loadFailed: boolean
  clearCommentsAfterAccessLoss: () => void
  markCommentsLoadFailed: () => void
  mergeChangedComments: (comments: ReviewComment[]) => void
  replaceFullyLoadedComments: (comments: ReviewComment[]) => void
  resetComments: () => void
  startRefreshingComments: () => void
}
