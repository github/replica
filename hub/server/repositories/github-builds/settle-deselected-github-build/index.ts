import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { githubDeselectedWorkflowFailure } from "../../../utils/github-deselected-workflow-failure/index.ts"

/** Stops only the unfinished Build still owned by the deselected run and attempt. */
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
  const owned = {
    githubWorkflowRunId: BigInt(run.id),
    githubWorkflowRunAttempt: { lte: run.runAttempt },
    commitSha: run.headSha,
    state: { in: ["queued" as const, "running" as const] },
    prototype: {
      branchName: run.headBranch,
      branchDeletedAt: null,
      repository: { githubRepositoryId: BigInt(input.githubRepositoryId), removedAt: null },
    },
  }
  return database.$transaction(async (transaction) => {
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
