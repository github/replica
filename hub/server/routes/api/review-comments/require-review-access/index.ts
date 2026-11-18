import type { Response } from "express"

import type { ReviewAccessActor, ReviewRouteDependencies } from "../../product/types.ts"

export async function requireReviewAccess(
  response: Response,
  dependencies: ReviewRouteDependencies,
  repositoryId: string,
  actor: ReviewAccessActor,
  permission: "view" | "change",
): Promise<boolean> {
  const access = await dependencies.authorizeReviewAccess(repositoryId, actor)
  const allowed = permission === "view" ? access.canView : access.canChange
  if (allowed) return true

  response.status(404).json({ error: "Review access is not available." })
  return false
}
