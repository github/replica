import type { AnchorResolution } from "@utils/review-anchor/types"
import type { ReviewCommentsCopy, ReviewThread } from "@utils/review-comment/types"

export interface ReviewCommentMarkersProps {
  threads: ReviewThread[]
  resolutions: Map<number, AnchorResolution>
  selectedThreadId: number | null
  selectionBlocked: boolean
  focusSelectedMarker?: boolean
  showAreaHighlightsOnlyWhenSelected?: boolean
  copy: Pick<
    ReviewCommentsCopy,
    | "heading"
    | "markerLabel"
    | "unreadMarkerLabel"
    | "markerWithRepliesLabel"
    | "unreadMarkerWithRepliesLabel"
  >
  onSelect: (thread: ReviewThread) => void
}
