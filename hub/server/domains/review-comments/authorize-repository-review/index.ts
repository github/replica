export interface RepositoryReviewAccess {
  canChange: boolean
  canView: boolean
}

export function authorizeRepositoryReview(
  actor: { provider: string },
  repository: { localPath: string | null } | null,
): RepositoryReviewAccess {
  const allowed = repository
    ? actor.provider === "local"
      ? Boolean(repository.localPath)
      : !repository.localPath
    : false
  return {
    canChange: allowed,
    canView: allowed,
  }
}
