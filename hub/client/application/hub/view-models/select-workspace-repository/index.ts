import type { WorkspaceResponse } from "@application/hub/contracts/types"

export function selectWorkspaceRepository(workspace: WorkspaceResponse, search: URLSearchParams) {
  const requested = search.get("repositoryId")?.toLowerCase()
  return workspace.repositories.find(({ id }) => id === requested) ?? workspace.repositories[0]
}
