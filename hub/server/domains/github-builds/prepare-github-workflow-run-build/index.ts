import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { GitHubWorkflowRun } from "../../../integrations/github/create-github-actions-client/types.ts"
import { prepareGitHubBuild } from "../../../repositories/github-builds/prepare-github-build/index.ts"
import { isGitHubWorkflowBranchPush } from "../is-github-workflow-branch-push/index.ts"

/**
 * Finds or creates the Build for a Replica workflow branch push run, using GitHub's
 * record of the run so webhook and pushed imports order runs the same way.
 */
export async function prepareGitHubWorkflowRunBuild(
  database: PrismaClient,
  githubRepositoryId: number,
  run: GitHubWorkflowRun,
  workflowPaths: string[],
) {
  if (
    !isGitHubWorkflowBranchPush(githubRepositoryId, run) ||
    !workflowPaths.includes(run.path.split("@")[0] ?? "")
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
    branchName: run.headBranch,
    commitSha: run.headSha,
    run: buildRun,
    author: null,
  })
  if (prepared.status !== "ready") return prepared
  return { ...prepared, buildRun }
}
