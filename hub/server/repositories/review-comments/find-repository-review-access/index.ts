import type { Prisma } from "../../../generated/prisma/client.ts"

export async function findRepositoryReviewAccess(
  database: Pick<Prisma.TransactionClient, "repository">,
  repositoryId: string,
) {
  return database.repository.findFirst({
    where: { id: repositoryId, removedAt: null },
    select: { localPath: true, nameWithOwner: true },
  })
}
