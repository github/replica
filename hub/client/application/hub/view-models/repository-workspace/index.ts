import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"
import type { RepositoryRecord, WorkspaceResponse } from "@application/hub/contracts/types"

import { workspaceNavigation } from "../workspace-navigation"

export function repositoryWorkspace(workspace: WorkspaceResponse, repository: RepositoryRecord) {
  const browseTemplates = workspace.repositories.find(({ id }) => id === repository.id)
    ?.capabilities?.browseTemplates
  const canManageAnalytics =
    repository.capabilities?.manageAnalytics ||
    workspace.repositories.find((entry) => entry.id === repository.id)?.capabilities
      ?.manageAnalytics
  return {
    ...workspaceNavigation(workspace, repository.id),
    analyticsLabel: "Analytics",
    analyticsPath: canManageAnalytics ? `/repositories/${repository.id}/analytics` : null,
    learningsLabel: "Learnings",
    learningsPath: null,
    newPrototypeLabel: "Create",
    newPrototypePath: browseTemplates ? `/repositories/${repository.id}/new` : null,
    prototypesLabel: "Prototypes",
    prototypesPath: `/repositories/${repository.id}`,
    repositories: workspace.repositories.map((item) => ({
      id: String(item.id),
      nameWithOwner: item.nameWithOwner,
      path: `/repositories/${item.id}`,
    })),
    repositoryMenuLabel: "Repositories",
    repositorySelectorLabel: `Choose repository. ${repository.nameWithOwner} selected`,
    selectedRepositoryId: String(repository.id),
    selectedSection: "prototypes",
  } satisfies RepositoryWorkspaceData
}
