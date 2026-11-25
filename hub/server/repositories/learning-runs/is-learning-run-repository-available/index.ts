import type { Prisma } from "../../../generated/prisma/client.ts"

export async function isLearningRunRepositoryAvailable(
  database: Pick<Prisma.TransactionClient, "repository">,
  repositoryId: string,
  requireGitHubId: boolean,
) {
  return (
    (await database.repository.count({
      where: {
        id: repositoryId,
        removedAt: null,
        ...(requireGitHubId ? { githubRepositoryId: { gt: 0n } } : {}),
      },
    })) === 1
  )
}
