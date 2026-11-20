import type { ProductViewer, WorkspaceProductRouteDependencies } from "../types.ts"

export function canStartPrototypeSession(
  product: Pick<WorkspaceProductRouteDependencies, "isRepositoryVisible">,
  viewer: ProductViewer,
  repositoryId: string,
) {
  // Preparing a prompt does not write to the repository.
  return viewer.sessionProvider
    ? product.isRepositoryVisible(viewer, repositoryId)
    : Promise.resolve(false)
}
