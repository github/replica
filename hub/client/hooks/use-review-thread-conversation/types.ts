import type { ReviewCommentMutation } from "@hooks/use-review-comments/types"
import type { ReviewComment, ReviewThread } from "@utils/review-comment/types"

export interface UseReviewThreadConversationOptions {
  thread: ReviewThread
  bodyMaximumBytes: number
  mutation: ReviewCommentMutation | null
  onClose: () => void
  onDraftStateChange: (active: boolean) => void
  onReply: (body: string) => Promise<boolean>
  onEdit: (commentId: number, body: string) => Promise<boolean>
  onDelete: (commentId: number) => Promise<boolean>
  onResolve: () => Promise<boolean>
  onReopen: () => Promise<boolean>
}

export interface ReviewThreadConversationState {
  replyDraft: string
  replyFailed: boolean
  editingCommentId: number | null
  editDraft: string
  editFailed: boolean
  confirmingEditDiscard: boolean
  confirmingDeleteId: number | null
  deleteFailed: boolean
  resolutionFailed: boolean
  confirmingDiscard: boolean
  draftActive: boolean
  replyBodyTooLong: boolean
  editBodyTooLong: boolean
  resolved: boolean
  replyBlocked: boolean
}

export interface ReviewThreadConversationActions {
  requestDismissal: () => void
  discardAndClose: () => void
  keepDraft: () => void
  submitReply: () => Promise<void>
  changeReplyDraft: (draft: string) => void
  startEdit: (comment: ReviewComment) => void
  changeEditDraft: (draft: string) => void
  saveEdit: (commentId: number) => Promise<void>
  cancelEdit: () => void
  keepEdit: () => void
  discardEdit: () => void
  requestDelete: (commentId: number) => void
  cancelDelete: () => void
  deleteComment: (commentId: number) => Promise<void>
  changeResolution: () => Promise<void>
}
