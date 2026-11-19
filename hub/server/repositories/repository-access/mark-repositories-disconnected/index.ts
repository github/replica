import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Hides repositories the GitHub App can no longer read. Prototypes, Builds and
 * reviews are kept so reconnecting the repository restores them.
 */
export async function markRepositoriesDisconnected(
  database: Pick<Prisma.TransactionClient, "repository" | "shareLink">,
  selection:
    | { githubRepositoryIds: Array<number | bigint> }
    | { exceptGithubRepositoryIds: Array<number | bigint> },
): Promise<number> {
  const githubRepositoryId =
    "githubRepositoryIds" in selection
      ? { in: selection.githubRepositoryIds.map(BigInt) }
      : { not: null, notIn: selection.exceptGithubRepositoryIds.map(BigInt) }
  const removedAt = new Date()
  const repositories = await database.repository.updateManyAndReturn({
    data: { removedAt },
    where: { githubRepositoryId, removedAt: null },
    select: { id: true },
  })
  if (repositories.length > 0) {
    await database.shareLink.updateMany({
      where: {
        createdByExternalIdentityId: { not: null },
        revokedAt: null,
        prototype: { repositoryId: { in: repositories.map(({ id }) => id) } },
      },
      data: { revokedAt: removedAt },
    })
  }
  return repositories.length
}
