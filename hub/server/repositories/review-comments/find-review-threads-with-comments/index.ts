import type { Prisma } from "../../../generated/prisma/client.ts"
import { reviewThreadInclude } from "../types.ts"

/**
 * Loads only the review threads that contain the given comments, so showing a learning's
 * evidence does not read every thread in the repository.
 */
export function findReviewThreadsWithComments(
  database: Pick<Prisma.TransactionClient, "reviewThread">,
  repositoryId: string,
  commentIds: number[],
) {
  if (commentIds.length === 0) return Promise.resolve([])
  return database.reviewThread.findMany({
    where: { repositoryId, comments: { some: { publicId: { in: commentIds } } } },
    include: reviewThreadInclude,
  })
}
