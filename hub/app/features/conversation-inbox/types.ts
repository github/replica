export type ConversationActivityKind =
  "comment" | "mention" | "reply" | "reaction" | "resolved" | "reopened"

export interface ConversationActivity {
  id: number
  actor: { login: string; name: string | null; avatarUrl: string | null }
  kind: ConversationActivityKind
  reactionContent?: ReviewReactionContent | null
  prototype: string
  repository: string
  excerpt: string
  createdAt: string
  read: boolean
  target: { prototypeId: number; threadId: number; commentId: number }
  path?: string
}

export interface ConversationInboxCopy {
  heading: string
  all: string
  unread: string
  unreadCount: string
  empty: string
  emptyDescription: string
  emptyUnread: string
  emptyUnreadDescription: string
  viewAll: string
  markRead: string
  markUnread: string
  actions: Record<ConversationActivityKind, string>
}
import type { ReviewReactionContent } from "@utils/review-comment/types"
