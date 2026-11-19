import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { GitHubBuildRun } from "../types.ts"

export async function markGitHubBuildRunning(
  database: PrismaClient,
  buildId: string,
  run: Pick<GitHubBuildRun, "runId" | "runAttempt">,
) {
  const result = await database.build.updateMany({
    where: {
      id: buildId,
      state: "queued",
      githubWorkflowRunId: run.runId,
      githubWorkflowRunAttempt: run.runAttempt,
    },
    data: { state: "running", startedAt: new Date() },
  })
  return result.count === 1
}
