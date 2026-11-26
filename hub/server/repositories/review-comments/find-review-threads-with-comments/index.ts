import type { Prisma } from "../../../generated/prisma/client.ts"
import { reviewThreadInclude } from "../types.ts"

/**
 * Loads only the review threads that contain the given comments, so showing a learning's
 * evidence does not read every thread in the repository. It applies the same repository
 * availability rules as a full review snapshot, so evidence never outlives repository access.
 */
export function findReviewThreadsWithComments(
  database: Pick<Prisma.TransactionClient, "reviewThread">,
  repositoryId: string,
  commentIds: number[],
  requireGitHubId: boolean,
) {
  if (commentIds.length === 0) return Promise.resolve([])
  return database.reviewThread.findMany({
    where: {
      repositoryId,
      repository: {
        removedAt: null,
        ...(requireGitHubId ? { githubRepositoryId: { not: null } } : {}),
      },
      comments: { some: { publicId: { in: commentIds } } },
    },
    include: reviewThreadInclude,
  })
}
