import type { WorkspaceNavData } from "@features/workspace-nav/types"

export interface HubWorkspaceData extends WorkspaceNavData {
  productName: string
  navigationLabel: string
  repositoriesLabel: string
  repositoriesPath: string
  repositoryUnavailableMessage?: string | null
}
