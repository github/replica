import type { Prisma } from "../../../generated/prisma/client.ts"
import { type RepositoryScope, visibleRepositoryWhere } from "../visible-repository-where/index.ts"

export function findActiveRepository(
  database: Pick<Prisma.TransactionClient, "repository">,
  repositoryId: string,
  scope: RepositoryScope,
) {
  return database.repository.findFirst({
    where: { id: repositoryId, ...visibleRepositoryWhere(scope) },
    select: { id: true, nameWithOwner: true, defaultBranch: true },
  })
}
