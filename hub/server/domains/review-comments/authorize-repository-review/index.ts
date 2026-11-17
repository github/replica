export interface RepositoryReviewAccess {
  canChange: boolean
  canView: boolean
}

export function authorizeRepositoryReview(
  actor: { provider: string },
  repository: { localPath: string | null } | null,
): RepositoryReviewAccess {
  const localAccess = actor.provider === "local" && Boolean(repository?.localPath)
  return {
    canChange: localAccess,
    canView: localAccess,
  }
}
