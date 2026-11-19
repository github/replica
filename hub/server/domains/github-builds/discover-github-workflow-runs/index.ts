import type { Logger } from "pino"

import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { GitHubWorkflowRun } from "../../../integrations/github/create-github-actions-client/types.ts"
import { listGitHubBuildRuns } from "../../../repositories/github-builds/list-github-build-runs/index.ts"
import { listGitHubBranchIdentities } from "../../../repositories/prototypes/list-github-branch-identities/index.ts"
import { listConnectedGitHubRepositories } from "../../../repositories/repository-access/list-connected-github-repositories/index.ts"
import type { GitHubWorkflowRunJob } from "../get-github-workflow-run-job-definition/index.ts"
import { refreshGitHubBranchHeads } from "../refresh-github-branch-heads/index.ts"

type SavedRun = Awaited<ReturnType<typeof listGitHubBuildRuns>>[number]

export interface DiscoverGitHubWorkflowRunsDependencies {
  database: PrismaClient
  listWorkflowRuns: (githubRepositoryId: number, createdAfter: Date) => Promise<GitHubWorkflowRun[]>
  listBranchHeads: (
    githubRepositoryId: number,
  ) => Promise<{ branchName: string; commitSha: string }[]>
  isAncestor: (githubRepositoryId: number, base: string, head: string) => Promise<boolean>
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
  {
    database,
    listWorkflowRuns,
    listBranchHeads,
    isAncestor,
    logger,
  }: DiscoverGitHubWorkflowRunsDependencies,
  { createdAfter }: { createdAfter: Date },
): Promise<GitHubWorkflowRunJob[]> {
  const jobs: GitHubWorkflowRunJob[] = []
  for (const repository of await listConnectedGitHubRepositories(database)) {
    const githubRepositoryId = Number(repository.githubRepositoryId)
    try {
      await refreshGitHubBranchHeads({ database, listBranchHeads, isAncestor }, githubRepositoryId)
    } catch (error) {
      logger.warn({ err: error, githubRepositoryId }, "GitHub branch head discovery failed")
    }
    try {
      const identities = await listGitHubBranchIdentities(database, githubRepositoryId)
      const runs = (await listWorkflowRuns(githubRepositoryId, createdAfter)).filter((run) => {
        if (!run.headBranch || run.headBranch === "replica/install-workflow") return false
        const owner = identities.get(run.headBranch)
        return !(
          owner?.branchIdentityStartedAt &&
          run.createdAt <= owner.branchIdentityStartedAt &&
          run.headSha !== owner.branchHeadSha
        )
      })
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
