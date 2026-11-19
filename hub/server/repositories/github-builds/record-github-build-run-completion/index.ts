import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { GitHubBuildRun } from "../types.ts"

/**
 * Records that the owning run finished and every artifact pass has run. Recovery treats
 * a successful Build without this time as still owing a screenshot pass.
 */
export async function recordGitHubBuildRunCompletion(
  database: PrismaClient,
  input: { buildId: string; run: Pick<GitHubBuildRun, "runId" | "runAttempt">; completedAt: Date },
) {
  const result = await database.build.updateMany({
    where: {
      id: input.buildId,
      state: "successful",
      githubWorkflowRunId: input.run.runId,
      githubWorkflowRunAttempt: input.run.runAttempt,
      workflowCompletedAt: null,
    },
    data: { workflowCompletedAt: input.completedAt },
  })
  return result.count === 1
}
