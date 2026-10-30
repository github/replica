import type { ReviewCommentAuthor } from "@utils/review-comment/types"

export interface ReviewParticipantStackProps {
  participants: ReviewCommentAuthor[]
  size: "small" | "medium"
}
