import type { Prisma } from "../../../generated/prisma/client.ts"

/** Keeps a tombstone even when deletion arrives before the branch's first import. */
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
  const existing = await database.prototype.findFirst({ where, select: { id: true } })
  if (existing) {
    await database.prototype.updateMany({
      where: { ...where, branchDeletedAt: null },
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
