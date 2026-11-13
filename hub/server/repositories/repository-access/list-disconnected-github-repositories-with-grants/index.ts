import type { Prisma } from "../../../generated/prisma/client.ts"

export async function listDisconnectedGitHubRepositoriesWithGrants(
  database: Pick<Prisma.TransactionClient, "repository">,
) {
  return database.repository.findMany({
    select: { githubRepositoryId: true },
    where: {
      accessGrants: { some: {} },
      githubRepositoryId: { not: null },
      removedAt: { not: null },
    },
  })
}
