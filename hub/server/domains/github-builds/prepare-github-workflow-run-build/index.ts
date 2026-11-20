import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { GitHubWorkflowRun } from "../../../integrations/github/create-github-actions-client/types.ts"
import { prepareGitHubBuild } from "../../../repositories/github-builds/prepare-github-build/index.ts"
import { recordGitHubBuildAuthor } from "../../../repositories/github-builds/record-github-build-author/index.ts"
import type { createGitHubActionsClient } from "../../../integrations/github/create-github-actions-client/index.ts"
import { replicaWorkflowPath } from "../constants.ts"

/**
 * Finds or creates the Build for a Replica workflow branch push run, using GitHub's
 * record of the run so webhook and pushed imports order runs the same way.
 */
export async function prepareGitHubWorkflowRunBuild(
  database: PrismaClient,
  githubRepositoryId: number,
  run: GitHubWorkflowRun,
  getCommitAuthor: ReturnType<typeof createGitHubActionsClient>["getCommitAuthor"],
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
  const author = await getCommitAuthor(run.headSha)
  const prepared = await prepareGitHubBuild(database, {
    githubRepositoryId,
    branchName,
    commitSha: run.headSha,
    run: buildRun,
    author,
  })
  if (prepared.status !== "ready") return prepared
  if (author) {
    await recordGitHubBuildAuthor(database, {
      buildId: prepared.buildId,
      commitSha: run.headSha,
      author,
    })
  }
  return { ...prepared, buildRun }
}
