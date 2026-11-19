import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { GitHubBuildRun } from "../types.ts"

function boundedFailureSummary(summary: string) {
  let value = summary.trim() || "The GitHub Actions Build failed."
  while (Buffer.byteLength(value) > 1000) value = value.slice(0, -1)
  return value
}

/** Marks an unfinished Build failed. Successful Builds are never changed. */
export async function completeGitHubBuildFailure(
  database: PrismaClient,
  input: {
    buildId: string
    run: Pick<GitHubBuildRun, "runId" | "runAttempt">
    completedAt: Date | null
    failureSummary: string
  },
) {
  const owned = {
    id: input.buildId,
    state: { in: ["queued" as const, "running" as const] },
    githubWorkflowRunId: input.run.runId,
    githubWorkflowRunAttempt: input.run.runAttempt,
  }
  return database.$transaction(async (transaction) => {
    const active = await transaction.build.findFirst({ where: owned, select: { startedAt: true } })
    if (!active) return false
    const finishedAt = new Date()
    const result = await transaction.build.updateMany({
      where: owned,
      data: {
        state: "failed",
        startedAt: active.startedAt ?? finishedAt,
        finishedAt,
        workflowCompletedAt: input.completedAt,
        failureSummary: boundedFailureSummary(input.failureSummary),
      },
    })
    return result.count === 1
  })
}
