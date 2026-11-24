import type { PropsWithChildren } from "react"

import { Button } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"
import { WorkspaceNav } from "@features/workspace-nav"
import { WorkspaceFrame } from "@features/workspace-frame"

import type { HubWorkspaceData } from "./types"

/** Repository context is navigation, never an access grant for Hub content. */
export function HubWorkspace({
  children,
  data,
  defaultNavigationCollapsed = false,
  contentResetKey,
  onRetryPermissions,
}: PropsWithChildren<{
  data: HubWorkspaceData
  defaultNavigationCollapsed?: boolean
  contentResetKey?: string
  onRetryPermissions?: () => void
}>) {
  return (
    <WorkspaceFrame
      defaultNavigationCollapsed={defaultNavigationCollapsed}
      contentResetKey={contentResetKey}
      navigation={(collapsed, onCollapsedChange) => (
        <WorkspaceNav data={data} collapsed={collapsed} onCollapsedChange={onCollapsedChange} />
      )}
    >
      {data.repositoryUnavailableMessage ? (
        <HubAlert title={data.repositoryUnavailableMessage} variant="warning" />
      ) : null}
      {onRetryPermissions ? (
        <HubAlert
          title="Hub could not check repository management permissions."
          variant="warning"
          action={
            <Button size="small" variant="secondary" onClick={onRetryPermissions}>
              Retry permission check
            </Button>
          }
        />
      ) : null}
      {children}
    </WorkspaceFrame>
  )
}
