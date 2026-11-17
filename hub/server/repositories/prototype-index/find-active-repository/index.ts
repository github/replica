import type { Prisma } from "../../../generated/prisma/client.ts"

export function findActiveRepository(
  database: Pick<Prisma.TransactionClient, "repository">,
  repositoryId: string,
) {
  return database.repository.findFirst({
    where: { id: repositoryId, removedAt: null },
    select: { id: true, nameWithOwner: true, defaultBranch: true },
  })
}
