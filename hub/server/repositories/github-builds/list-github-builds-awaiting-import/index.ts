import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { githubDeselectedWorkflowFailure } from "../../../utils/github-deselected-workflow-failure/index.ts"

/**
 * Lists recent GitHub Builds that still owe an import or completed-run pass,
 * including failed Builds whose author lookup is pending. A deselected run's pass
 * settles its Build, so it leaves this list.
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
        {
          state: "failed",
          workflowCompletedAt: null,
          authorProvider: null,
          failureSummary: { not: githubDeselectedWorkflowFailure },
        },
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
