import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { compareTimestampAndId } from "../../../utils/compare-timestamp-and-id/index.ts"

/**
 * Preserves branch histories across deletion. Network evidence names the exact owner
 * and revision captured before the request, never whichever identity owns the name now.
 */
export async function recordGitHubBranchHeads(
  database: PrismaClient,
  input: {
    githubRepositoryId: number
    heads: {
      branchName: string
      commitSha: string
      observed: { id: string; branchPresenceRevision: number } | null
      resumeRetired: boolean
    }[]
    observedAt: Date
  },
) {
  for (const head of input.heads) {
    if (head.branchName === "replica/install-workflow") continue
    await database.$transaction(async (transaction) => {
      // Share the lock order with deletion and workflow preparation.
      const [repository] = await transaction.$queryRaw<
        Array<{ id: string; defaultBranch: string }>
      >`
        SELECT "id", "default_branch" AS "defaultBranch" FROM "repositories"
        WHERE "github_repository_id" = ${BigInt(input.githubRepositoryId)} AND "removed_at" IS NULL
        FOR UPDATE
      `
      if (!repository) return
      const owner = await transaction.prototype.findFirst({
        where: { repositoryId: repository.id, branchName: head.branchName },
        orderBy: [
          { branchDeletedAt: { sort: "desc", nulls: "first" } },
          { branchPresenceRevision: "desc" },
          { id: "desc" },
        ],
        select: {
          id: true,
          branchDeletedAt: true,
          branchPresenceRevision: true,
          currentBuildId: true,
          currentBuildRunCreatedAt: true,
          currentBuildRunId: true,
          currentBuild: { select: { workflowCreatedAt: true, githubWorkflowRunId: true } },
          updatedAt: true,
        },
      })
      if (
        (owner?.id ?? null) !== (head.observed?.id ?? null) ||
        (owner && owner.branchPresenceRevision !== head.observed?.branchPresenceRevision) ||
        (owner?.branchDeletedAt && owner.branchDeletedAt >= input.observedAt) ||
        (owner && !owner.branchDeletedAt && owner.updatedAt > input.observedAt)
      ) {
        return
      }

      // A replacement receives no retained metadata or relationships.
      let prototype = owner
      if (owner?.branchDeletedAt && !head.resumeRetired) {
        prototype = await transaction.prototype.create({
          data: {
            repositoryId: repository.id,
            branchName: head.branchName,
            replica: head.branchName === repository.defaultBranch,
            branchIdentityStartedAt: owner.branchDeletedAt,
            branchHeadSha: head.commitSha,
            branchPresenceRevision: owner.branchPresenceRevision + 1,
          },
          include: {
            currentBuild: { select: { workflowCreatedAt: true, githubWorkflowRunId: true } },
          },
        })
      } else if (owner) {
        prototype = await transaction.prototype.update({
          where: { id: owner.id },
          data: {
            branchDeletedAt: null,
            retiredHeadSha: null,
            branchHeadSha: head.commitSha,
            branchPresenceRevision: { increment: 1 },
          },
          include: {
            currentBuild: { select: { workflowCreatedAt: true, githubWorkflowRunId: true } },
          },
        })
      }
      if (!prototype) return
      // Repeated same-head listings still advance the revision, but not run timestamps.
      const build = await transaction.build.findUnique({
        where: {
          prototypeId_commitSha: { prototypeId: prototype.id, commitSha: head.commitSha },
        },
        select: { id: true, state: true, workflowCreatedAt: true, githubWorkflowRunId: true },
      })
      if (!build || build.state === "superseded") return
      if (prototype.currentBuildId !== build.id) {
        const latestRun = [
          { createdAt: build.workflowCreatedAt, id: build.githubWorkflowRunId },
          { createdAt: prototype.currentBuildRunCreatedAt, id: prototype.currentBuildRunId },
          {
            createdAt: prototype.currentBuild?.workflowCreatedAt ?? null,
            id: prototype.currentBuild?.githubWorkflowRunId ?? null,
          },
        ].reduce((latest, candidate) =>
          compareTimestampAndId(candidate, latest) > 0 ? candidate : latest,
        )
        await transaction.prototype.update({
          where: { id: prototype.id },
          data: {
            currentBuildId: build.id,
            currentBuildRunCreatedAt: latestRun.createdAt,
            currentBuildRunId: latestRun.id,
          },
        })
      }
      const identity = {
        repositoryId: repository.id,
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
