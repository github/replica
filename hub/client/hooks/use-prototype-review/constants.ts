import type { ReviewCommentFilters } from "@utils/review-comment/types"

export const DEFAULT_REVIEW_COMMENT_FILTERS: ReviewCommentFilters = {
  search: "",
  currentBuildOnly: false,
  currentPageOnly: false,
  showResolved: false,
  showRead: true,
  onlyMine: false,
  participant: null,
}
