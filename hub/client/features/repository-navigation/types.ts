import type {
  RepositoryNavigationContext,
  WorkspaceSidebarData,
} from "@features/workspace-sidebar/types"

export interface RepositoryNavigationData
  extends WorkspaceSidebarData, RepositoryNavigationContext {}
