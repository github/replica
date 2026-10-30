import type { ReviewCommentMutation } from "@hooks/use-review-comments/types"
import type {
  ReviewComment,
  ReviewCommentsCopy,
  ReviewReactionContent,
} from "@utils/review-comment/types"

export interface ReviewCommentReactionsProps {
  comment: ReviewComment
  mutation: ReviewCommentMutation | null
  actionsDisabled: boolean
  controlsHidden?: boolean
  copy: Pick<
    ReviewCommentsCopy,
    | "addReactionLabel"
    | "reactionCountOneLabel"
    | "reactionCountOtherLabel"
    | "reactionErrorLabel"
    | "reactionLabels"
  >
  onAdd: (content: ReviewReactionContent) => Promise<boolean>
  onRemove: (content: ReviewReactionContent) => Promise<boolean>
  onBurst: (emoji: string, x: number, y: number) => void
}
