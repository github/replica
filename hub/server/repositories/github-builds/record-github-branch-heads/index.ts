import type { PrismaClient } from "../../../generated/prisma/client.ts"

/**
 * Selects an existing Build when GitHub's branch head returns to its commit. Missing
 * Builds remain for workflow discovery; a partial branch list never deletes anything.
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
        select: { id: true, prototypeId: true, prototype: { select: { repositoryId: true } } },
      })
      if (!build) return
      const selected = await transaction.prototype.updateMany({
        where: {
          id: build.prototypeId,
          branchDeletedAt: null,
          OR: [
            { currentBuildRunCreatedAt: null },
            { currentBuildRunCreatedAt: { lte: input.observedAt } },
          ],
        },
        data: { currentBuildId: build.id, currentBuildRunCreatedAt: input.observedAt },
      })
      if (selected.count !== 1) return
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
