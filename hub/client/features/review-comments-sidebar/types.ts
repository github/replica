import type { AnchorResolution } from "@utils/review-anchor/types"
import type { ReactNode } from "react"
import type {
  ReviewCommentAuthor,
  ReviewCommentFilters,
  ReviewCommentsCopy,
  ReviewThread,
} from "@utils/review-comment/types"

export interface ReviewCommentsSidebarProps {
  frame?: {
    open: boolean
    className?: string
    contentClassName?: string
  }
  threads: ReviewThread[]
  currentBuildNumber: number
  buildLinkOrigin?: string
  totalCount: number
  hasThreads: boolean
  filters: ReviewCommentFilters
  participants: ReviewCommentAuthor[]
  resolutions: Map<number, AnchorResolution>
  selectedThreadId: number | null
  selectionBlocked: boolean
  closeBlocked: boolean
  showPins: boolean
  loading: boolean
  loadFailed: boolean
  notice?: ReactNode
  copy: ReviewCommentsCopy
  onClose: () => void
  onFiltersChange: (filters: ReviewCommentFilters) => void
  onShowPinsChange: (showPins: boolean) => void
  onRetry: () => void
  onSelect: (thread: ReviewThread) => void
}
