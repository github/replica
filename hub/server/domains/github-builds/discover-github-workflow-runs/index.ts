import type { Logger } from "pino"

import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { GitHubWorkflowRun } from "../../../integrations/github/create-github-actions-client/types.ts"
import { listGitHubBuildRuns } from "../../../repositories/github-builds/list-github-build-runs/index.ts"
import { listConnectedGitHubRepositories } from "../../../repositories/repository-access/list-connected-github-repositories/index.ts"
import type { GitHubWorkflowRunJob } from "../get-github-workflow-run-job-definition/index.ts"

type SavedRun = Awaited<ReturnType<typeof listGitHubBuildRuns>>[number]

export interface DiscoverGitHubWorkflowRunsDependencies {
  database: PrismaClient
  listWorkflowRuns: (githubRepositoryId: number, createdAfter: Date) => Promise<GitHubWorkflowRun[]>
  logger: Pick<Logger, "warn">
}

/**
 * A run is settled once its Build can no longer change: a successful Build whose
 * completed-run pass finished, a superseded Build, or a failure that this attempt
 * cannot reopen. Everything else still needs an import pass.
 */
function settled(run: GitHubWorkflowRun, saved: SavedRun[]) {
  return saved.some(
    (build) =>
      build.runId === run.id &&
      ((build.state === "successful" && build.workflowCompletedAt !== null) ||
        build.state === "superseded" ||
        (build.state === "failed" && build.runAttempt >= run.runAttempt)),
  )
}

/**
 * Polls each connected repository for recent Replica runs whose import webhooks may
 * have been missed. One repository's failure does not block the others.
 */
export async function discoverGitHubWorkflowRuns(
  { database, listWorkflowRuns, logger }: DiscoverGitHubWorkflowRunsDependencies,
  { createdAfter }: { createdAfter: Date },
): Promise<GitHubWorkflowRunJob[]> {
  const jobs: GitHubWorkflowRunJob[] = []
  for (const repository of await listConnectedGitHubRepositories(database)) {
    const githubRepositoryId = Number(repository.githubRepositoryId)
    try {
      const runs = (await listWorkflowRuns(githubRepositoryId, createdAfter)).filter(
        (run) => run.headBranch !== null && run.headBranch !== "replica/install-workflow",
      )
      const saved = await listGitHubBuildRuns(database, {
        githubRepositoryId,
        runIds: runs.map((run) => run.id),
      })
      for (const run of runs) {
        if (!settled(run, saved)) jobs.push({ githubRepositoryId, runId: run.id })
      }
    } catch (error) {
      logger.warn({ err: error, githubRepositoryId }, "GitHub workflow run discovery failed")
    }
  }
  return jobs
}
