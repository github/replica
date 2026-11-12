import type { ReviewCommentMutation } from "@hooks/use-review-comments/types"
import type { AnchorPoint } from "@utils/review-anchor/types"
import type {
  ReviewCommentsCopy,
  ReviewReactionContent,
  ReviewThread,
} from "@utils/review-comment/types"

export interface ReviewThreadConversationProps {
  thread: ReviewThread
  anchorPoint: AnchorPoint | null
  bodyMaximumBytes: number
  mutation: ReviewCommentMutation | null
  copy: ReviewCommentsCopy
  readOnly?: boolean
  onClose: () => void
  onDraftStateChange: (active: boolean) => void
  onReply: (body: string) => Promise<boolean>
  onEdit: (commentId: number, body: string) => Promise<boolean>
  onDelete: (commentId: number) => Promise<boolean>
  onResolve: () => Promise<boolean>
  onReopen: () => Promise<boolean>
  onAddReaction: (commentId: number, content: ReviewReactionContent) => Promise<boolean>
  onRemoveReaction: (commentId: number, content: ReviewReactionContent) => Promise<boolean>
  onMarkRead: (activityVersion: number) => Promise<boolean>
  onMarkUnread: () => Promise<boolean>
}
