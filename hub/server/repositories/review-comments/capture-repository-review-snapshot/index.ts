import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { reviewThreadInclude } from "../types.ts"

export function captureRepositoryReviewSnapshotRecords(
  database: Pick<PrismaClient, "$transaction">,
  repositoryId: string,
) {
  return database.$transaction(
    async (transaction) => {
      const repository = await transaction.repository.findFirst({
        where: { id: repositoryId, removedAt: null },
        select: { id: true, nameWithOwner: true },
      })
      if (!repository) return null
      const threads = await transaction.reviewThread.findMany({
        where: { repositoryId },
        include: reviewThreadInclude,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
      return { repository, threads }
    },
    { isolationLevel: "RepeatableRead" },
  )
}
