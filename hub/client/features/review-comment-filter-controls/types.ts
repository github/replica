import type {
  ReviewCommentAuthor,
  ReviewCommentFilters,
  ReviewCommentsCopy,
} from "@utils/review-comment/types"

export interface ReviewCommentFilterControlsProps {
  compact?: boolean
  filters: ReviewCommentFilters
  participants: ReviewCommentAuthor[]
  showPins: boolean
  supportsReadState?: boolean
  copy: ReviewCommentsCopy
  onFiltersChange: (filters: ReviewCommentFilters) => void
  onShowPinsChange: (showPins: boolean) => void
}
