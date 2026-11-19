import type { Logger } from "pino"

import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { GitHubWorkflowRun } from "../../../integrations/github/create-github-actions-client/types.ts"
import { listGitHubBuildRuns } from "../../../repositories/github-builds/list-github-build-runs/index.ts"
import { recordGitHubBranchHeads } from "../../../repositories/github-builds/record-github-branch-heads/index.ts"
import { listConnectedGitHubRepositories } from "../../../repositories/repository-access/list-connected-github-repositories/index.ts"
import type { GitHubWorkflowRunJob } from "../get-github-workflow-run-job-definition/index.ts"

type SavedRun = Awaited<ReturnType<typeof listGitHubBuildRuns>>[number]

export interface DiscoverGitHubWorkflowRunsDependencies {
  database: PrismaClient
  listWorkflowRuns: (githubRepositoryId: number, createdAfter: Date) => Promise<GitHubWorkflowRun[]>
  listBranchHeads: (
    githubRepositoryId: number,
  ) => Promise<{ branchName: string; commitSha: string }[]>
  logger: Pick<Logger, "warn">
}

/**
 * A run is settled once its Build can no longer change: a successful Build whose
 * completed-run pass finished, a superseded Build, or a failure that this attempt
 * cannot reopen. Everything else still needs an import pass.
 */
function settled(run: GitHubWorkflowRun, saved: SavedRun[]) {
  return saved.some((build) => {
    if (build.branchName !== run.headBranch || build.commitSha !== run.headSha) return false
    if (build.state === "superseded" || build.branchDeletedAt !== null) return true
    if (build.runId !== run.id) {
      return build.state === "successful" || (build.runId !== null && build.runId > run.id)
    }
    return (
      build.runAttempt >= run.runAttempt &&
      ((build.state === "successful" && build.workflowCompletedAt !== null) ||
        build.state === "failed")
    )
  })
}

/**
 * Polls each connected repository for recent Replica runs whose import webhooks may
 * have been missed. One repository's failure does not block the others.
 */
export async function discoverGitHubWorkflowRuns(
  { database, listWorkflowRuns, listBranchHeads, logger }: DiscoverGitHubWorkflowRunsDependencies,
  { createdAfter }: { createdAfter: Date },
): Promise<GitHubWorkflowRunJob[]> {
  const jobs: GitHubWorkflowRunJob[] = []
  for (const repository of await listConnectedGitHubRepositories(database)) {
    const githubRepositoryId = Number(repository.githubRepositoryId)
    const observedAt = new Date()
    try {
      await recordGitHubBranchHeads(database, {
        githubRepositoryId,
        heads: await listBranchHeads(githubRepositoryId),
        observedAt,
      })
    } catch (error) {
      logger.warn({ err: error, githubRepositoryId }, "GitHub branch head discovery failed")
    }
    try {
      const runs = (await listWorkflowRuns(githubRepositoryId, createdAfter)).filter(
        (run) => run.headBranch !== null && run.headBranch !== "replica/install-workflow",
      )
      const saved = await listGitHubBuildRuns(database, {
        githubRepositoryId,
        runs,
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
