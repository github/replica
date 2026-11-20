import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { GitHubBuildRun } from "../types.ts"

/**
 * Records completed author and artifact passes per contributing run without changing
 * dist ownership. Owning-run completion also retains its existing Build watermark.
 */
export async function recordGitHubBuildRunCompletion(
  database: PrismaClient,
  input: { buildId: string; run: Pick<GitHubBuildRun, "runId" | "runAttempt">; completedAt: Date },
) {
  return database.$transaction(async (transaction) => {
    const build = await transaction.build.findFirst({
      where: { id: input.buildId, state: "successful" },
      select: { id: true },
    })
    if (!build) return false
    const run = {
      buildId: build.id,
      githubWorkflowRunId: input.run.runId,
    }
    await transaction.gitHubBuildRunCompletion.createMany({
      data: [{ ...run, runAttempt: input.run.runAttempt, completedAt: input.completedAt }],
      skipDuplicates: true,
    })
    await transaction.gitHubBuildRunCompletion.updateMany({
      where: { ...run, runAttempt: { lt: input.run.runAttempt } },
      data: { runAttempt: input.run.runAttempt, completedAt: input.completedAt },
    })
    await transaction.build.updateMany({
      where: {
        id: input.buildId,
        state: "successful",
        githubWorkflowRunId: input.run.runId,
        githubWorkflowRunAttempt: input.run.runAttempt,
        workflowCompletedAt: null,
      },
      data: { workflowCompletedAt: input.completedAt },
    })
    return true
  })
}
