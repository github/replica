import type { ReviewCommentsCopy } from "@utils/review-comment/types"

export interface ReviewCommentControlProps {
  bridgeReady: boolean
  copy: ReviewCommentsCopy
  selectionBlocked: boolean
  selecting: boolean
  cycleShortcut?: boolean
  visibilityAction?: {
    label: string
    onToggle: () => void
  }
  onCancelSelection: () => void
  onStartAreaSelection: () => void
  onStartElementSelection: () => void
}
