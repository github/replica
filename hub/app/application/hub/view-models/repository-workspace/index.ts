import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"

import type { RepositoryRecord, WorkspaceResponse } from "../../contracts"
import { resourcePath } from "../resource-path"

export function repositoryWorkspace(
  workspace: WorkspaceResponse,
  repository: RepositoryRecord,
  search: URLSearchParams,
): RepositoryWorkspaceData {
  return {
    accountMenuLabel: `Account menu for @${workspace.viewer.login}`,
    authenticityToken: "",
    collapseNavigationLabel: "Collapse sidebar",
    currentUser: workspace.viewer,
    darkThemeLabel: "Dark",
    expandNavigationLabel: "Expand sidebar",
    feedbackLabel: "Feedback",
    lightThemeLabel: "Light",
    navigationLabel: "Repository navigation",
    newPrototypeLabel: "Create",
    newPrototypePath: null,
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
    signOutLabel: "Sign out",
    signOutPath: "/session",
    systemThemeLabel: "System",
  }
}
