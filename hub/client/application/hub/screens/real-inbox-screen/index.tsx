import { useSearchParams } from "react-router"

import type { WorkspaceResponse } from "@application/hub/contracts/types"
import { hubWorkspace } from "@application/hub/view-models/hub-workspace"
import { useNotificationInbox } from "@hooks/use-notification-inbox"
import { NotificationsPage } from "@pages/notifications-page"
import { notificationInboxConfiguration } from "@utils/notification/inbox-configuration"

export function RealInboxScreen({ workspace }: { workspace: WorkspaceResponse }) {
  const [search, setSearch] = useSearchParams()
  const inbox = useNotificationInbox({
    path: notificationInboxConfiguration.path,
    authenticityToken: "",
    unreadOnly: search.get("unread") === "true",
    synchronize: true,
  })
  return (
    <NotificationsPage
      data={{
        ...hubWorkspace(workspace, search, "notifications"),
        notificationInbox: { ...notificationInboxConfiguration, connected: true },
      }}
      {...inbox}
      onFilter={(unread) => {
        setSearch(
          (current) => {
            const next = new URLSearchParams(current)
            if (unread) next.set("unread", "true")
            else next.delete("unread")
            return next
          },
          { replace: true, preventScrollReset: true },
        )
      }}
    />
  )
}
