import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Hides repositories the GitHub App can no longer read. Prototypes, Builds and
 * reviews are kept so reconnecting the repository restores them.
 */
export async function markRepositoriesDisconnected(
  database: Pick<Prisma.TransactionClient, "repository">,
  selection:
    | { githubRepositoryIds: Array<number | bigint> }
    | { exceptGithubRepositoryIds: Array<number | bigint> },
): Promise<number> {
  const githubRepositoryId =
    "githubRepositoryIds" in selection
      ? { in: selection.githubRepositoryIds.map(BigInt) }
      : { not: null, notIn: selection.exceptGithubRepositoryIds.map(BigInt) }
  const result = await database.repository.updateMany({
    data: { removedAt: new Date() },
    where: { githubRepositoryId, removedAt: null },
  })
  return result.count
}
