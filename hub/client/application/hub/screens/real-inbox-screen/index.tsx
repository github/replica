import { useSearchParams } from "react-router"

import type { WorkspaceResponse } from "@application/hub/contracts/types"
import { repositoryWorkspace } from "@application/hub/view-models/repository-workspace"
import { workspaceNavigation } from "@application/hub/view-models/workspace-navigation"
import { useNotificationInbox } from "@hooks/use-notification-inbox"
import { NotificationsPage } from "@pages/notifications-page"
import { notificationInboxConfiguration } from "@utils/notification/inbox-configuration"

export function RealInboxScreen({ workspace }: { workspace: WorkspaceResponse }) {
  const [search, setSearch] = useSearchParams()
  const repository = workspace.repositories.find(({ id }) => id === search.get("repositoryId"))
  const inbox = useNotificationInbox({
    path: notificationInboxConfiguration.path,
    authenticityToken: "",
    unreadOnly: search.get("unread") === "true",
    synchronize: true,
  })
  return (
    <NotificationsPage
      data={{
        ...workspaceNavigation(workspace, repository?.id ?? null, search, true),
        repository: repository ? repositoryWorkspace(workspace, repository, search, true) : null,
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
