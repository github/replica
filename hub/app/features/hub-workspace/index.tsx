import type { PropsWithChildren } from "react"

import { HubAlert } from "@components/hub-alert"
import { WorkspaceSidebar } from "@features/workspace-sidebar"
import { WorkspaceFrame } from "@features/workspace-frame"

import type { HubWorkspaceData } from "./types"

/** Repository context is navigation, never an access grant for Hub content. */
export function HubWorkspace({
  children,
  data,
  defaultNavigationCollapsed = false,
}: PropsWithChildren<{
  data: HubWorkspaceData
  defaultNavigationCollapsed?: boolean
}>) {
  return (
    <WorkspaceFrame
      defaultNavigationCollapsed={defaultNavigationCollapsed}
      navigation={(collapsed, onCollapsedChange) => (
        <WorkspaceSidebar data={data} collapsed={collapsed} onCollapsedChange={onCollapsedChange} />
      )}
    >
      {data.repositoryUnavailableMessage ? (
        <HubAlert title={data.repositoryUnavailableMessage} variant="warning" />
      ) : null}
      {children}
    </WorkspaceFrame>
  )
}
