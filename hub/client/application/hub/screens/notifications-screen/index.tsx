import { useEffect, useRef } from "react"

import { useNotificationInbox } from "@hooks/use-notification-inbox"
import { NotificationsPage } from "@pages/notifications-page"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import type { SettingsWorkspaceResponse } from "@application/hub/settings-contracts/types"
import { settingsNotifications } from "@application/hub/view-models/settings-notifications"

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
  const previousState = useRef(state)
  const { onOpen } = inbox
  useEffect(() => {
    if (previousState.current === state) return
    previousState.current = state
    onOpen()
  }, [state, onOpen])

  return <NotificationsPage data={data} {...inbox} onFilter={onFilter} />
}
