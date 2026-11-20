import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { githubDeselectedWorkflowFailure } from "../../../utils/github-deselected-workflow-failure/index.ts"

/**
 * Stops only the unfinished Build still owned by the deselected run and attempt.
 * After the run completes, a finished Build still awaiting its completed-run pass
 * keeps its state, failure, dist, and author, and records only the completion so
 * direct recovery stops retrying it.
 */
export async function settleDeselectedGitHubBuild(
  database: PrismaClient,
  input: {
    githubRepositoryId: number
    run: {
      id: number
      runAttempt: number
      headBranch: string
      headSha: string
      status: string
      updatedAt: Date
    }
  },
) {
  const { run } = input
  const runOwned = {
    githubWorkflowRunId: BigInt(run.id),
    githubWorkflowRunAttempt: { lte: run.runAttempt },
    commitSha: run.headSha,
    prototype: {
      branchName: run.headBranch,
      branchDeletedAt: null,
      repository: { githubRepositoryId: BigInt(input.githubRepositoryId), removedAt: null },
    },
  }
  const owned = { ...runOwned, state: { in: ["queued" as const, "running" as const] } }
  return database.$transaction(async (transaction) => {
    if (run.status === "completed") {
      const finished = await transaction.build.updateMany({
        where: {
          ...runOwned,
          state: { in: ["successful", "failed"] },
          workflowCompletedAt: null,
        },
        data: { workflowCompletedAt: run.updatedAt },
      })
      if (finished.count > 0) return true
    }
    const build = await transaction.build.findFirst({
      where: owned,
      select: { id: true, startedAt: true },
    })
    if (!build) return false
    const finishedAt = new Date()
    const result = await transaction.build.updateMany({
      where: { ...owned, id: build.id },
      data: {
        state: "failed",
        githubWorkflowRunAttempt: run.runAttempt,
        startedAt: build.startedAt ?? finishedAt,
        finishedAt,
        workflowCompletedAt: run.status === "completed" ? run.updatedAt : null,
        failureSummary: githubDeselectedWorkflowFailure,
      },
    })
    return result.count === 1
  })
}
