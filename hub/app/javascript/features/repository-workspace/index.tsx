import type { MouseEventHandler, PropsWithChildren, ReactNode } from "react"

import type { RepositorySelectorStatus } from "@components/repository-selector/types"
import { RepositoryNavigation } from "@features/repository-navigation"
import { WorkspaceFrame } from "@features/workspace-frame"

import type { RepositoryWorkspaceData } from "./types"

/** Frames repository pages with repository, section, and account navigation. */
export function RepositoryWorkspace({
  children,
  data,
  defaultNavigationCollapsed = false,
  inboxPreview,
  onInboxClick,
  repositoryChoices,
}: PropsWithChildren<{
  data: RepositoryWorkspaceData
  defaultNavigationCollapsed?: boolean
  inboxPreview?: (close: () => void) => ReactNode
  onInboxClick?: MouseEventHandler<HTMLAnchorElement>
  repositoryChoices?: RepositorySelectorStatus
}>) {
  return (
    <WorkspaceFrame
      defaultNavigationCollapsed={defaultNavigationCollapsed}
      navigation={(collapsed, onCollapsedChange) => (
        <RepositoryNavigation
          data={data}
          collapsed={collapsed}
          onCollapsedChange={onCollapsedChange}
          inboxPreview={inboxPreview}
          onInboxClick={onInboxClick}
          repositoryChoices={repositoryChoices}
        />
      )}
    >
      {children}
    </WorkspaceFrame>
  )
}
