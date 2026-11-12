import type { ReviewAnchor } from "@utils/review-anchor/types"
import type {
  ReviewComment,
  ReviewReactionContent,
  ReviewRootComment,
} from "@utils/review-comment/types"

export type ReviewCommentMutation =
  | { kind: "create" }
  | { kind: "reply"; commentId: number }
  | { kind: "edit"; commentId: number }
  | { kind: "delete"; commentId: number }
  | { kind: "resolve"; commentId: number }
  | { kind: "reopen"; commentId: number }
  | { kind: "mark-unread"; commentId: number }
  | { kind: "add-reaction"; commentId: number; content: ReviewReactionContent }
  | { kind: "remove-reaction"; commentId: number; content: ReviewReactionContent }

export interface ReviewCommentsState {
  comments: ReviewComment[]
  loading: boolean
  loadFailed: boolean
  mutation: ReviewCommentMutation | null
  mutationError?: string | null
  refreshComments: () => void
  createComment: (
    buildNumber: number,
    body: string,
    anchor: ReviewAnchor,
  ) => Promise<ReviewComment | null>
  createReply: (rootId: number, body: string) => Promise<ReviewComment | null>
  editComment: (commentId: number, body: string) => Promise<ReviewComment | null>
  deleteComment: (commentId: number) => Promise<ReviewComment | null>
  resolveThread: (rootId: number) => Promise<ReviewComment | null>
  reopenThread: (rootId: number) => Promise<ReviewComment | null>
  addReaction: (commentId: number, content: ReviewReactionContent) => Promise<ReviewComment | null>
  removeReaction: (
    commentId: number,
    content: ReviewReactionContent,
  ) => Promise<ReviewComment | null>
  markThreadRead: (rootId: number, activityVersion: number) => Promise<ReviewRootComment | null>
  markThreadUnread: (rootId: number) => Promise<ReviewRootComment | null>
}
