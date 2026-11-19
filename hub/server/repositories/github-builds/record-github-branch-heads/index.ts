import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"

/**
 * A listing that began after a deletion was recorded proves the branch exists
 * again, whether it was recreated or the delete event was stale. The retained identity
 * resumes with its metadata and Builds; nothing is deleted or replaced.
 */
async function restoreListedBranch(
  transaction: Prisma.TransactionClient,
  githubRepositoryId: number,
  branchName: string,
  observedAt: Date,
) {
  const repository = { githubRepositoryId: BigInt(githubRepositoryId), removedAt: null }
  const latest = await transaction.prototype.findFirst({
    where: { branchName, repository },
    orderBy: [{ branchDeletedAt: { sort: "desc", nulls: "first" } }, { id: "desc" }],
    select: { id: true, branchDeletedAt: true },
  })
  if (!latest?.branchDeletedAt || latest.branchDeletedAt >= observedAt) return
  await transaction.prototype.updateMany({
    where: { id: latest.id, branchDeletedAt: { lt: observedAt } },
    data: { branchDeletedAt: null },
  })
}

/**
 * Selects an existing Build when GitHub's branch head returns to its commit. Missing
 * Builds remain for workflow discovery; a partial branch list never deletes anything.
 * Heads must come from a listing that began at or after observedAt.
 */
export async function recordGitHubBranchHeads(
  database: PrismaClient,
  input: {
    githubRepositoryId: number
    heads: { branchName: string; commitSha: string }[]
    observedAt: Date
  },
) {
  for (const head of input.heads) {
    if (head.branchName === "replica/install-workflow") continue
    await database.$transaction(async (transaction) => {
      await restoreListedBranch(
        transaction,
        input.githubRepositoryId,
        head.branchName,
        input.observedAt,
      )
      const build = await transaction.build.findFirst({
        where: {
          commitSha: head.commitSha,
          state: { not: "superseded" },
          prototype: {
            branchName: head.branchName,
            branchDeletedAt: null,
            repository: {
              githubRepositoryId: BigInt(input.githubRepositoryId),
              removedAt: null,
            },
          },
        },
        select: {
          id: true,
          prototypeId: true,
          workflowCreatedAt: true,
          prototype: {
            select: {
              repositoryId: true,
              currentBuildId: true,
              currentBuildRunCreatedAt: true,
              currentBuild: { select: { workflowCreatedAt: true } },
            },
          },
        },
      })
      if (!build) return
      if (build.prototype.currentBuildId !== build.id) {
        const latestRunAt = [
          build.workflowCreatedAt,
          build.prototype.currentBuildRunCreatedAt,
          build.prototype.currentBuild?.workflowCreatedAt,
        ].reduce<Date | null>(
          (latest, time) => (time && (!latest || time > latest) ? time : latest),
          null,
        )
        const selected = await transaction.prototype.updateMany({
          where: {
            id: build.prototypeId,
            branchDeletedAt: null,
            // A webhook may have selected a newer head while GitHub was listing branches.
            updatedAt: { lte: input.observedAt },
          },
          data: {
            currentBuildId: build.id,
            currentBuildRunCreatedAt: latestRunAt,
          },
        })
        if (selected.count !== 1) return
      }
      const identity = {
        repositoryId: build.prototype.repositoryId,
        branchName: head.branchName,
        commitSha: head.commitSha,
      }
      await transaction.branchHeadObservation.upsert({
        where: { repositoryId_branchName_commitSha: identity },
        create: { ...identity, buildId: build.id, lastObservedAt: input.observedAt },
        update: { buildId: build.id, lastObservedAt: input.observedAt },
      })
    })
  }
}
