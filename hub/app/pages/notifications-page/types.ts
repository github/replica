import type { HubWorkspaceData } from "@features/hub-workspace/types"
import type { InboxNotification, NotificationInboxConfiguration } from "@utils/notification/types"

export interface NotificationsPageData extends HubWorkspaceData {
  notificationInbox: NotificationInboxConfiguration
}

export interface NotificationsPageProps {
  data: NotificationsPageData
  notifications: InboxNotification[]
  unreadCount: number
  unreadOnly: boolean
  loading: boolean
  failed: boolean
  hasMore: boolean
  onFilter: (unread: boolean) => void
  onToggleRead: (id: number) => void
  onLoadMore: () => void
  onRetry: () => void
}
