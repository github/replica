import { useNotificationInbox } from "@hooks/use-notification-inbox"
import { NotificationsPage } from "@pages/notifications-page"

import type { WorkspaceResponse } from "../../contracts"
import type { SettingsWorkspaceResponse } from "../../settings-contracts"
import { settingsNotifications } from "../../view-models/settings-notifications"

export function NotificationsScreen({
  workspace,
  state,
  search,
  onFilter,
}: {
  workspace: WorkspaceResponse
  state: SettingsWorkspaceResponse
  search: URLSearchParams
  onFilter: (unread: boolean) => void
}) {
  const data = settingsNotifications(workspace, state, search)
  const inbox = useNotificationInbox({
    path: data.notificationInbox.path,
    authenticityToken: "",
    initialUnreadCount: state.notifications.unreadCount,
    initialUnreadOnly: state.notifications.unreadOnly,
  })

  return <NotificationsPage data={data} {...inbox} onFilter={onFilter} />
}
