import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Keeps a tombstone even when deletion arrives before the branch's first import.
 * The first retirement fixes the continuity anchor; later historical imports or delete
 * deliveries must not replace it.
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
    orderBy: [
      { branchDeletedAt: { sort: "desc", nulls: "first" } },
      { branchPresenceRevision: "desc" },
      { id: "desc" },
    ],
    select: {
      id: true,
      branchDeletedAt: true,
      branchHeadSha: true,
      currentBuild: { select: { commitSha: true } },
    },
  })
  if (existing) {
    // A repeated deletion refreshes the tombstone so an older branch listing cannot restore it.
    await database.prototype.update({
      where: { id: existing.id },
      data: {
        branchDeletedAt: new Date(),
        branchPresenceRevision: { increment: 1 },
        ...(!existing.branchDeletedAt
          ? { retiredHeadSha: existing.branchHeadSha ?? existing.currentBuild?.commitSha ?? null }
          : {}),
      },
    })
  } else {
    await database.prototype.create({
      data: {
        ...where,
        branchDeletedAt: new Date(),
        branchPresenceRevision: 1,
        replica: input.branchName === repository.defaultBranch,
      },
    })
  }
}
