import type { AnchorResolution } from "@utils/review-anchor/types"
import type { ReviewCommentsCopy, ReviewThread } from "@utils/review-comment/types"

export interface ReviewCommentRowProps {
  thread: ReviewThread
  currentBuildNumber: number
  resolution?: AnchorResolution
  anchorStatusLabel?: string | null
  selected: boolean
  selectionBlocked: boolean
  copy: Pick<
    ReviewCommentsCopy,
    | "buildLabel"
    | "changedAnchorLabel"
    | "deletedCommentLabel"
    | "missingAnchorLabel"
    | "movedAnchorLabel"
    | "replyCountOneLabel"
    | "replyCountOtherLabel"
    | "resolvedLabel"
    | "routeMismatchLabel"
    | "selectionBlockedLabel"
    | "unreadLabel"
  >
  onSelect: (thread: ReviewThread) => void
  buildHref?: string
}
