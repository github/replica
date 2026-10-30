import type { NotificationsPageData } from "@pages/notifications-page/types"

import type { WorkspaceResponse } from "../../contracts"
import type { SettingsWorkspaceResponse } from "../../settings-contracts"
import { settingsWorkspace } from "../settings-workspace"

export function settingsNotifications(
  workspace: WorkspaceResponse,
  state: SettingsWorkspaceResponse,
  search: URLSearchParams,
): NotificationsPageData {
  return {
    ...settingsWorkspace(workspace, state, search, "notifications"),
    notificationInbox: {
      path: "/api/settings/workspace",
      copy: {
        heading: "Inbox",
        all: "All",
        unread: "Unread",
        unreadCount: "%{count} unread",
        empty: "No mock notifications",
        emptyDescription: "Synthetic review activity will appear here.",
        emptyUnread: "You're all caught up",
        emptyUnreadDescription: "No unread mock notifications.",
        viewAll: "View inbox",
        markRead: "Mark as read",
        markUnread: "Mark as unread",
        actions: {
          comment: "started a mock conversation",
          mention: "mentioned you in a mock conversation",
          reply: "replied to a mock conversation",
          reaction: "reacted to a mock comment",
          resolved: "resolved a mock conversation",
          reopened: "reopened a mock conversation",
        },
        error: "The mock inbox could not be updated. Retry without leaving this page.",
        loading: "Loading mock notifications…",
        loadMore: "Load more",
        retry: "Retry",
      },
    },
  }
}
