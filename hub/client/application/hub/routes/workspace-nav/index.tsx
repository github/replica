import { matchPath, Outlet, useLocation, useOutletContext } from "react-router"

import type { WorkspaceResponse } from "@application/hub/contracts/types"
import { readWorkspaceRepositoryId } from "@application/hub/read-workspace-repository-id"
import { hubWorkspace } from "@application/hub/view-models/hub-workspace"
import { WorkspaceInboxCountContext } from "@application/hub/workspace-inbox-count-context"
import { HubWorkspace } from "@features/hub-workspace"
import { useNotificationInbox } from "@hooks/use-notification-inbox"

export default function PersistentWorkspaceNav() {
  const workspace = useOutletContext<WorkspaceResponse | null>()
  const { pathname, search } = useLocation()
  const mock = import.meta.env.DEV && import.meta.env.MODE === "mock"
  const params = new URLSearchParams(search)
  const repositoryId = readWorkspaceRepositoryId({ pathname, searchParams: params })
  if (repositoryId) params.set("repositoryId", repositoryId)
  const section = matchPath("/notifications", pathname)
    ? "notifications"
    : matchPath("/repositories/:repositoryId/new", pathname)
      ? "new"
      : "prototypes"
  const data = workspace && !mock ? hubWorkspace(workspace, params, section) : null
  const configuration = data?.notificationInbox
  const inbox = useNotificationInbox({
    path: configuration?.path,
    authenticityToken: data?.authenticityToken ?? "",
    initialUnreadCount: data?.notificationsUnreadCount,
    initialUnreadOnly: true,
    autoLoad: false,
    autoCount: Boolean(configuration) && section !== "notifications",
    synchronize: Boolean(configuration),
    limit: 10,
  })
  const content = <Outlet context={workspace} />
  if (!data) return content

  return (
    <WorkspaceInboxCountContext value={inbox.onUnreadCountChange}>
      <HubWorkspace
        data={{
          ...data,
          liveInbox: configuration
            ? {
                ...inbox,
                copy: configuration.copy,
                // Reopen with an authorized list, not excerpts fetched on another page.
                onOpen: () => inbox.onOpen(true),
              }
            : undefined,
          inboxPreviewScope: pathname,
        }}
      >
        {content}
      </HubWorkspace>
    </WorkspaceInboxCountContext>
  )
}
