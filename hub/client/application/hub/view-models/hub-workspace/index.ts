import type { WorkspaceResponse } from "@application/hub/contracts/types"
import type { HubWorkspaceData } from "@features/hub-workspace/types"

import { repositoryWorkspace } from "../repository-workspace"
import { selectWorkspaceRepository } from "../select-workspace-repository"
import { workspaceNavigation } from "../workspace-navigation"

export function hubWorkspace<Section extends HubWorkspaceData["selectedSection"]>(
  workspace: WorkspaceResponse,
  search: URLSearchParams,
  selectedSection: Section,
): HubWorkspaceData & { selectedSection: Section } {
  const selected = selectWorkspaceRepository(workspace, search)
  const repository = selected ? repositoryWorkspace(workspace, selected) : null
  return {
    ...(repository ?? workspaceNavigation(workspace, null)),
    repository,
    selectedSection,
  }
}
