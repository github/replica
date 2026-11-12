import type { ReviewCommentMutation } from "@hooks/use-review-comments/types"
import type { ReviewComment, ReviewCommentsCopy } from "@utils/review-comment/types"
import type { ReviewReactionContent } from "@utils/review-comment/types"

export interface ReviewThreadMessageProps {
  comment: ReviewComment
  mutation: ReviewCommentMutation | null
  copy: ReviewCommentsCopy
  editing: boolean
  editDraft: string
  editBodyTooLong: boolean
  editFailed: boolean
  confirmingEditDiscard: boolean
  saving: boolean
  confirmingDelete: boolean
  deleting: boolean
  deleteFailed: boolean
  actionsDisabled: boolean
  onStartEdit: () => void
  onEditDraftChange: (draft: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onKeepEdit: () => void
  onDiscardEdit: () => void
  onRequestDelete: () => void
  onCancelDelete: () => void
  onDelete: () => void
  onAddReaction: (content: ReviewReactionContent) => Promise<boolean>
  onRemoveReaction: (content: ReviewReactionContent) => Promise<boolean>
  onBurstReaction: (emoji: string, x: number, y: number) => void
  onMarkUnread?: () => void
  markUnreadDisabled?: boolean
}
