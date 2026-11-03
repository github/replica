import { useNotificationInbox } from "@hooks/use-notification-inbox"
import type { RepositoryInboxData } from "@utils/notification/types"

export function useRepositoryInbox<T extends RepositoryInboxData>(
  data: T,
  callbacks: Pick<
    Parameters<typeof useNotificationInbox>[0],
    "onReadChange" | "onUnreadCountChange"
  > = {},
): T {
  const inbox = useNotificationInbox({
    path: data.notificationInbox?.path,
    authenticityToken: data.authenticityToken,
    initialUnreadCount: data.notificationsUnreadCount,
    autoLoad: false,
    initialUnreadOnly: true,
    limit: 10,
    ...callbacks,
  })

  if (!data.notificationInbox) return data

  return {
    ...data,
    notificationsUnread: inbox.unreadCount > 0,
    notificationsUnreadCount: inbox.unreadCount,
    notificationsUnreadLabel: `${data.notificationsLabel}, ${data.notificationInbox.copy.unreadCount.replace("%{count}", String(inbox.unreadCount))}`,
    liveInbox: {
      ...inbox,
      copy: data.notificationInbox.copy,
    },
  }
}
