import type { PrismaClient } from "../../../generated/prisma/client.ts"

/** Includes commit reuse and newer owners when finding the import state of each run. */
export async function listGitHubBuildRuns(
  database: PrismaClient,
  {
    githubRepositoryId,
    runs,
  }: {
    githubRepositoryId: number
    runs: readonly { id: number; headBranch: string | null; headSha: string }[]
  },
) {
  if (runs.length === 0) return []
  const builds = await database.build.findMany({
    where: {
      prototype: { repository: { githubRepositoryId: BigInt(githubRepositoryId) } },
      OR: [
        { githubWorkflowRunId: { in: runs.map((run) => BigInt(run.id)) } },
        ...runs.flatMap((run) =>
          run.headBranch
            ? [{ commitSha: run.headSha, prototype: { branchName: run.headBranch } }]
            : [],
        ),
      ],
    },
    select: {
      commitSha: true,
      prototype: { select: { branchName: true, branchDeletedAt: true } },
      githubWorkflowRunId: true,
      githubWorkflowRunAttempt: true,
      state: true,
      workflowCompletedAt: true,
    },
  })
  return builds.map((build) => ({
    runId: build.githubWorkflowRunId === null ? null : Number(build.githubWorkflowRunId),
    branchName: build.prototype.branchName,
    branchDeletedAt: build.prototype.branchDeletedAt,
    commitSha: build.commitSha,
    runAttempt: build.githubWorkflowRunAttempt ?? 0,
    state: build.state,
    workflowCompletedAt: build.workflowCompletedAt,
  }))
}
