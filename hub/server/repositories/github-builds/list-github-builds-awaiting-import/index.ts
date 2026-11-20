import type { PrismaClient } from "../../../generated/prisma/client.ts"

/**
 * Lists recent GitHub Builds whose import has not finished: the dist is still pending,
 * or the run has not been seen complete, so author resolution or screenshots may be owed.
 */
export async function listGitHubBuildsAwaitingImport(
  database: PrismaClient,
  { createdAfter, limit = 100 }: { createdAfter: Date; limit?: number },
) {
  const builds = await database.build.findMany({
    where: {
      githubWorkflowRunId: { not: null },
      createdAt: { gte: createdAfter },
      OR: [
        { state: { in: ["queued", "running"] } },
        { state: "successful", workflowCompletedAt: null },
      ],
      prototype: {
        branchDeletedAt: null,
        repository: { removedAt: null, githubRepositoryId: { not: null } },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      githubWorkflowRunId: true,
      prototype: { select: { repository: { select: { githubRepositoryId: true } } } },
    },
  })
  return builds.flatMap(({ githubWorkflowRunId, prototype }) => {
    const githubRepositoryId = prototype.repository.githubRepositoryId
    return githubWorkflowRunId === null || githubRepositoryId === null
      ? []
      : [{ githubRepositoryId: Number(githubRepositoryId), runId: Number(githubWorkflowRunId) }]
  })
}
