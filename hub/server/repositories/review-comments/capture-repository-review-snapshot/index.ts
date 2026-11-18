import type { Prisma } from "../../../generated/prisma/client.ts"
import { reviewThreadInclude } from "../types.ts"

export async function captureRepositoryReviewSnapshotRecords(
  database: Pick<Prisma.TransactionClient, "repository" | "reviewThread">,
  repositoryId: string,
  requireGitHubId: boolean,
) {
  const repository = await database.repository.findFirst({
    where: {
      id: repositoryId,
      removedAt: null,
      ...(requireGitHubId ? { githubRepositoryId: { not: null } } : {}),
    },
    select: { id: true, nameWithOwner: true },
  })
  if (!repository) return null
  const threads = await database.reviewThread.findMany({
    where: { repositoryId },
    include: reviewThreadInclude,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  })
  return { repository, threads }
}
