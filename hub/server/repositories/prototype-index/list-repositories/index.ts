import type { Prisma } from "../../../generated/prisma/client.ts"
import { type RepositoryScope, visibleRepositoryWhere } from "../visible-repository-where/index.ts"

export async function listRepositories(
  database: Pick<Prisma.TransactionClient, "repository">,
  scope: RepositoryScope = null,
) {
  return database.repository.findMany({
    where: visibleRepositoryWhere(scope),
    select: { id: true, nameWithOwner: true, defaultBranch: true },
    orderBy: [{ nameWithOwner: "asc" }, { id: "asc" }],
  })
}
