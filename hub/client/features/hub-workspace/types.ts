import type { WorkspaceSidebarData } from "@features/workspace-sidebar/types"

export interface HubWorkspaceData extends WorkspaceSidebarData {
  productName: string
  navigationLabel: string
  repositoriesLabel: string
  repositoriesPath: string
  repositoryUnavailableMessage?: string | null
}
