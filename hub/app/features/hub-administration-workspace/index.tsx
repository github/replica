import type { PropsWithChildren } from "react"

import { HubWorkspace } from "@features/hub-workspace"

import type { HubAdministrationWorkspaceData } from "./types"

/** Keeps Hub pages on the shared sidebar, even without repository access. */
export function HubAdministrationWorkspace({
  children,
  data,
  defaultNavigationCollapsed = false,
}: PropsWithChildren<{
  data: HubAdministrationWorkspaceData
  defaultNavigationCollapsed?: boolean
}>) {
  return (
    <HubWorkspace data={data} defaultNavigationCollapsed={defaultNavigationCollapsed}>
      {children}
    </HubWorkspace>
  )
}
