import type { GitHubWorkflowRun } from "../../../integrations/github/create-github-actions-client/types.ts"

export function isGitHubWorkflowBranchPush(
  githubRepositoryId: number,
  run: GitHubWorkflowRun,
): run is GitHubWorkflowRun & { headBranch: string } {
  return (
    run.repositoryId === githubRepositoryId &&
    run.event === "push" &&
    !!run.headBranch &&
    run.headBranch !== "replica/install-workflow" &&
    /^[0-9a-f]{40}$/.test(run.headSha) &&
    run.htmlUrl.startsWith("https://")
  )
}
