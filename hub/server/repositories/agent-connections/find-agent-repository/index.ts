import type { Prisma } from "../../../generated/prisma/client.ts"

/** Learnings belong to GitHub repositories, so agents can reach only those. */
export function findAgentRepository(
  database: Pick<Prisma.TransactionClient, "repository">,
  id: string,
) {
  return database.repository.findFirst({
    where: { id, removedAt: null, localPath: null, githubRepositoryId: { not: null } },
    select: {
      id: true,
      canvasId: true,
      githubRepositoryId: true,
      nameWithOwner: true,
      defaultBranch: true,
      localPath: true,
      removedAt: true,
    },
  })
}
