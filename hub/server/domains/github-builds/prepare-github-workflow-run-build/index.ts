import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { GitHubWorkflowRun } from "../../../integrations/github/create-github-actions-client/types.ts"
import { prepareGitHubBuild } from "../../../repositories/github-builds/prepare-github-build/index.ts"
import { replicaWorkflowPath } from "../constants.ts"

/**
 * Finds or creates the Build for a Replica workflow branch push run, using GitHub's
 * record of the run so webhook and pushed imports order runs the same way.
 */
export async function prepareGitHubWorkflowRunBuild(
  database: PrismaClient,
  githubRepositoryId: number,
  run: GitHubWorkflowRun,
) {
  const branchName = run.headBranch
  if (
    run.repositoryId !== githubRepositoryId ||
    run.path.split("@")[0] !== replicaWorkflowPath ||
    run.event !== "push" ||
    !branchName ||
    branchName === "replica/install-workflow" ||
    !/^[0-9a-f]{40}$/.test(run.headSha) ||
    !run.htmlUrl.startsWith("https://")
  ) {
    return { status: "ignored" as const }
  }
  const buildRun = {
    runId: BigInt(run.id),
    runAttempt: run.runAttempt,
    workflowUrl: run.htmlUrl,
    createdAt: run.createdAt,
  }
  const prepared = await prepareGitHubBuild(database, {
    githubRepositoryId,
    branchName,
    commitSha: run.headSha,
    run: buildRun,
    author: run.actor
      ? {
          providerUserId: String(run.actor.id),
          login: run.actor.login,
          avatarUrl: run.actor.avatarUrl,
        }
      : null,
  })
  if (prepared.status !== "ready") return prepared
  return { ...prepared, buildRun }
}
