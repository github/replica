import type { Prisma } from "../../../generated/prisma/client.ts"

export async function findRepositoryGitHubId(
  database: Pick<Prisma.TransactionClient, "repository">,
  repositoryId: string,
) {
  return await database.repository.findUnique({
    where: { id: repositoryId },
    select: { githubRepositoryId: true },
  })
}
