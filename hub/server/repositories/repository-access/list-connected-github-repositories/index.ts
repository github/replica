import type { Prisma } from "../../../generated/prisma/client.ts"

export async function listConnectedGitHubRepositories(
  database: Pick<Prisma.TransactionClient, "repository">,
) {
  return database.repository.findMany({
    select: { defaultBranch: true, githubRepositoryId: true, nameWithOwner: true },
    where: { githubRepositoryId: { not: null }, removedAt: null },
  })
}
