import type { WorkspaceNavData } from "@features/workspace-nav/types"

export interface WorkspaceRouteHandle {
  workspaceSection: NonNullable<WorkspaceNavData["selectedSection"]>
  independentOfRepositoryNavigation?: boolean
  signedOutEntry?: "home" | "canvas"
  defaultNavigationCollapsed?: boolean
}
