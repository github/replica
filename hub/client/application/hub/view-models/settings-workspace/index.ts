import type { HubWorkspaceData } from "@features/hub-workspace/types"
import type { WorkspaceResponse } from "@application/hub/contracts/types"

import { repositoryWorkspace } from "../repository-workspace"
import { workspaceNavigation } from "../workspace-navigation"
import type { NavigationState } from "./types"

export function settingsWorkspace(
  workspace: WorkspaceResponse,
  state: NavigationState,
  search: URLSearchParams,
  selectedSection: HubWorkspaceData["selectedSection"],
  real = false,
) {
  const currentWorkspace: WorkspaceResponse = {
    ...workspace,
    capabilities: state.session.capabilities,
    navigation: {
      welcomeHidden: state.welcomeHidden,
      notificationsUnreadCount: state.notifications.unreadCount,
    },
  }
  return {
    ...workspaceNavigation(currentWorkspace, state.repository?.id ?? null, search, real),
    selectedSection,
    repository: state.repository
      ? repositoryWorkspace(currentWorkspace, state.repository, search, real)
      : null,
  } satisfies HubWorkspaceData
}
