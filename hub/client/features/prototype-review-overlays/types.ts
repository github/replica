import type { ReviewCommentComposerProps } from "@features/review-comment-composer/types"
import type { ReviewThreadConversationProps } from "@features/review-thread-conversation/types"

export interface CanvasReviewOverlaysProps {
  selectionNotice: string | null
  rateLimitNotice: string | null
  composer: ReviewCommentComposerProps | null
  conversation: ReviewThreadConversationProps | null
}
