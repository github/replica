import type { z } from "zod"

import type { NOTIFICATION_READ_SCHEMA, NOTIFICATION_SCHEMA } from "./schemas"

export type InboxNotification = z.infer<typeof NOTIFICATION_SCHEMA>
export type NotificationReadUpdate = z.infer<typeof NOTIFICATION_READ_SCHEMA>

export interface NotificationInboxCopy {
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
  actions: Record<InboxNotification["kind"], string>
}

export interface NotificationInboxConfiguration {
  path: string
  copy: NotificationInboxCopy & {
    error: string
    loading: string
    loadMore: string
    retry: string
  }
}

export interface RepositoryInboxData {
  authenticityToken: string
  notificationInbox?: NotificationInboxConfiguration
  notificationsLabel?: string
  notificationsUnread?: boolean
  notificationsUnreadCount?: number
  notificationsUnreadLabel?: string
}
