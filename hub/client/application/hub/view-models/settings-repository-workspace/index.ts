import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"

import type { WorkspaceResponse } from "../../contracts"
import type { SettingsWorkspaceResponse } from "../../settings-contracts"
import { settingsWorkspace } from "../settings-workspace"

export function settingsRepositoryWorkspace(
  workspace: WorkspaceResponse,
  state: SettingsWorkspaceResponse,
  search: URLSearchParams,
  selectedSection: "analytics" | "learnings" | "audit",
): RepositoryWorkspaceData {
  const { repository } = settingsWorkspace(workspace, state, search, selectedSection)
  if (!repository) throw new Error("A repository settings page needs a selected repository.")
  return {
    ...repository,
    selectedSection,
  }
}
