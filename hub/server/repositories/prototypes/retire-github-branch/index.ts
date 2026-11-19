import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Keeps a tombstone even when deletion arrives before the branch's first import. Branch
 * discovery restores it only from a complete listing taken after this deletion.
 */
export async function retireGitHubBranch(
  database: Prisma.TransactionClient,
  input: { githubRepositoryId: number; branchName: string },
) {
  const [repository] = await database.$queryRaw<Array<{ id: string; defaultBranch: string }>>`
    SELECT "id", "default_branch" AS "defaultBranch" FROM "repositories"
    WHERE "github_repository_id" = ${BigInt(input.githubRepositoryId)} AND "removed_at" IS NULL
    FOR UPDATE
  `
  if (!repository) return
  // Force older serializable import snapshots to retry after acquiring their shared lock.
  await database.repository.update({
    where: { id: repository.id },
    data: { updatedAt: new Date() },
  })
  const where = { repositoryId: repository.id, branchName: input.branchName }
  const existing = await database.prototype.findFirst({
    where,
    orderBy: [{ branchDeletedAt: { sort: "desc", nulls: "first" } }, { id: "desc" }],
    select: { id: true },
  })
  if (existing) {
    // A repeated deletion refreshes the tombstone so an older branch listing cannot restore it.
    await database.prototype.update({
      where: { id: existing.id },
      data: { branchDeletedAt: new Date() },
    })
  } else {
    await database.prototype.create({
      data: {
        ...where,
        branchDeletedAt: new Date(),
        replica: input.branchName === repository.defaultBranch,
      },
    })
  }
}
