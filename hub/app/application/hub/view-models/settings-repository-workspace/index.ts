import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"

import type { WorkspaceResponse } from "../../contracts"
import type { SettingsWorkspaceResponse } from "../../settings-contracts"
import { repositoryWorkspace } from "../repository-workspace"
import { settingsWorkspace } from "../settings-workspace"

export function settingsRepositoryWorkspace(
  workspace: WorkspaceResponse,
  state: SettingsWorkspaceResponse,
  search: URLSearchParams,
  selectedSection: "analytics" | "learnings" | "audit",
): RepositoryWorkspaceData {
  if (!state.repository) throw new Error("A repository settings page needs a selected repository.")
  const hub = settingsWorkspace(workspace, state, search, selectedSection)
  return {
    ...repositoryWorkspace(workspace, state.repository, search),
    ...hub,
    ...hub.repository,
    selectedSection,
  }
}
