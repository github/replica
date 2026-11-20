import type { Prisma } from "../../../generated/prisma/client.ts"

export async function findConnectedGitHubRepository(
  database: Pick<Prisma.TransactionClient, "repository">,
  githubRepositoryId: number,
) {
  return database.repository.findFirst({
    where: { githubRepositoryId: BigInt(githubRepositoryId), removedAt: null },
    select: { id: true },
  })
}
