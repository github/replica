import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"

import type { RepositoryRecord, WorkspaceResponse } from "../../contracts/types"
import { resourcePath } from "../resource-path"
import { workspaceNavigation } from "../workspace-navigation"

export function repositoryWorkspace(
  workspace: WorkspaceResponse,
  repository: RepositoryRecord,
  search: URLSearchParams,
): RepositoryWorkspaceData {
  return {
    ...workspaceNavigation(workspace, repository.id, search),
    analyticsLabel: "Analytics",
    analyticsPath: resourcePath(`/repositories/${repository.id}/analytics`, search),
    learningsLabel: "Learnings",
    learningsPath: resourcePath(`/repositories/${repository.id}/learnings`, search),
    newPrototypeLabel: "Create",
    newPrototypePath: workspace.capabilities?.createPrototypes
      ? resourcePath(`/repositories/${repository.id}/new`, search)
      : null,
    prototypesLabel: "Prototypes",
    prototypesPath: resourcePath(`/repositories/${repository.id}`, search),
    repositories: workspace.repositories.map((item) => ({
      id: String(item.id),
      nameWithOwner: item.nameWithOwner,
      path: resourcePath(`/repositories/${item.id}`, search),
    })),
    repositoryMenuLabel: "Repositories",
    repositorySelectorLabel: `Choose repository. ${repository.nameWithOwner} selected`,
    selectedRepositoryId: String(repository.id),
    selectedSection: "prototypes",
  }
}
