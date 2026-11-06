import type { HubWorkspaceData } from "@features/hub-workspace/types"

import type { WorkspaceResponse } from "../../contracts/types"
import type { SettingsWorkspaceResponse } from "../../settings-contracts/types"
import { repositoryWorkspace } from "../repository-workspace"
import { workspaceNavigation } from "../workspace-navigation"

type NavigationState = Pick<SettingsWorkspaceResponse, "repository" | "welcomeHidden"> & {
  session: { capabilities: WorkspaceResponse["capabilities"] }
  notifications: Pick<SettingsWorkspaceResponse["notifications"], "unreadCount">
}

export function settingsWorkspace(
  workspace: WorkspaceResponse,
  state: NavigationState,
  search: URLSearchParams,
  selectedSection: HubWorkspaceData["selectedSection"],
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
    ...workspaceNavigation(currentWorkspace, state.repository?.id ?? null, search),
    selectedSection,
    repository: state.repository
      ? repositoryWorkspace(currentWorkspace, state.repository, search)
      : null,
  } satisfies HubWorkspaceData
}
