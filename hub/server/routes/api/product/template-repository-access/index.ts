import type { ProductViewer, WorkspaceProductRouteDependencies } from "../types.ts"

export function canBrowseTemplates(viewer: ProductViewer, local: boolean) {
  return local
    ? viewer.sessionProvider === "local" && viewer.role === "ADMINISTRATOR"
    : viewer.sessionProvider !== "local" && viewer.sessionProvider !== null
}

export async function canHandOffToCopilot(
  product: Pick<WorkspaceProductRouteDependencies, "getRepositoryPermission">,
  viewer: ProductViewer,
  repositoryId: string,
) {
  if (viewer.sessionProvider !== "github") return false
  const permission = await product.getRepositoryPermission?.(viewer, repositoryId)
  return permission === "write" || permission === "maintain" || permission === "admin"
}
