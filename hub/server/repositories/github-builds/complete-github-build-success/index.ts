import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { GitHubBuildRun, StoredGitHubBuildArtifact } from "../types.ts"

/**
 * Records the imported dist and marks the Build successful. Only the workflow run that
 * owns an unfinished Build may complete it; existing artifact rows are never replaced.
 */
export async function completeGitHubBuildSuccess(
  database: PrismaClient,
  input: {
    buildId: string
    run: Pick<GitHubBuildRun, "runId" | "runAttempt">
    completedAt: Date | null
    distDigest: string
    artifacts: StoredGitHubBuildArtifact[]
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
    // Completing first locks the row, so a run that lost ownership cannot add artifacts.
    const finishedAt = new Date()
    const result = await transaction.build.updateMany({
      where: owned,
      data: {
        state: "successful",
        distDigest: input.distDigest,
        startedAt: active.startedAt ?? finishedAt,
        finishedAt,
        workflowCompletedAt: input.completedAt,
        failureSummary: null,
      },
    })
    if (result.count !== 1) return false
    // An unfinished Build has no artifact rows, so any conflict aborts the whole import.
    await transaction.buildArtifact.createMany({
      data: input.artifacts.map((artifact) => ({ ...artifact, buildId: input.buildId })),
    })
    return true
  })
}
