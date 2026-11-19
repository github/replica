import type { PrismaClient } from "../../../generated/prisma/client.ts"

/** Returns the import state of Builds saved for the given runs of one repository. */
export async function listGitHubBuildRuns(
  database: PrismaClient,
  { githubRepositoryId, runIds }: { githubRepositoryId: number; runIds: readonly number[] },
) {
  if (runIds.length === 0) return []
  const builds = await database.build.findMany({
    where: {
      githubWorkflowRunId: { in: runIds.map(BigInt) },
      prototype: { repository: { githubRepositoryId: BigInt(githubRepositoryId) } },
    },
    select: {
      githubWorkflowRunId: true,
      githubWorkflowRunAttempt: true,
      state: true,
      workflowCompletedAt: true,
    },
  })
  return builds.map((build) => ({
    runId: Number(build.githubWorkflowRunId),
    runAttempt: build.githubWorkflowRunAttempt ?? 0,
    state: build.state,
    workflowCompletedAt: build.workflowCompletedAt,
  }))
}
