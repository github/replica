import type { Prisma } from "../../../generated/prisma/client.ts"
import type { ConnectedRepositoryEvidence } from "../types.ts"

export async function hasDisconnectedRepositories(
  database: Pick<Prisma.TransactionClient, "repository">,
  repositories: ConnectedRepositoryEvidence[],
): Promise<boolean> {
  if (!repositories.length) return false
  const found = await database.repository.findFirst({
    select: { id: true },
    where: {
      removedAt: { not: null },
      githubRepositoryId: {
        in: repositories.map((repository) => BigInt(repository.githubRepositoryId)),
      },
    },
  })
  return found !== null
}
