import type { ReviewCommentsCopy } from "@utils/review-comment/types"

export interface ReviewCommentControlProps {
  bridgeReady: boolean
  canCreateComment?: boolean
  copy: ReviewCommentsCopy
  selectionBlocked: boolean
  selecting: boolean
  visibilityAction?: {
    label: string
    onToggle: () => void
  }
  onCancelSelection: () => void
  onStartSelection: () => void
}
