import type { ReviewCommentsCopy } from "@utils/review-comment/types"

export interface ReviewCommentControlProps {
  bridgeReady: boolean
  copy: ReviewCommentsCopy
  selectionBlocked: boolean
  selecting: boolean
  onCancelSelection: () => void
  onStartAreaSelection: () => void
  onStartElementSelection: () => void
}
