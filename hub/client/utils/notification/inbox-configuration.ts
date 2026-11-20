import type { NotificationInboxConfiguration } from "./types"

export const notificationInboxConfiguration: NotificationInboxConfiguration = {
  path: "/api/notifications/inbox",
  copy: {
    heading: "Inbox",
    all: "All",
    unread: "Unread",
    unreadCount: "%{count} unread items",
    empty: "No activity yet",
    emptyDescription: "Mentions and updates to your conversations will appear here.",
    emptyUnread: "You are all caught up",
    emptyUnreadDescription: "No unread activity. Switch to All to revisit your conversations.",
    viewAll: "View all",
    markRead: "Mark as read",
    markUnread: "Mark as unread",
    actions: {
      comment: "commented on your prototype",
      mention: "mentioned you",
      reply: "replied to a conversation",
      reaction: "reacted to your comment",
      resolved: "resolved a conversation",
      reopened: "reopened a conversation",
    },
    error: "The inbox could not be updated. Retry without leaving this page.",
    loading: "Loading notifications…",
    loadMore: "Load more",
    retry: "Retry",
  },
}
