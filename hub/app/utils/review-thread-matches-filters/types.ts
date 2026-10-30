import type { ReviewRoute } from "@utils/review-anchor/types"
import type { ReviewCommentFilters } from "@utils/review-comment/types"

export interface ReviewThreadFilterContext {
  filters: ReviewCommentFilters
  viewerLogin: string
  selectedBuildNumber?: number | null
  selectedDraftRevisionId?: number | null
  route: ReviewRoute | null
}
