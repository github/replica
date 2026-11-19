export interface GitHubActionsRunIdentity {
  githubRepositoryId: number
  repository: string
  branchName: string
  commitSha: string
  runId: number
  runAttempt: number
}

export type GitHubActionsTokenResult =
  | { status: "verified"; run: GitHubActionsRunIdentity }
  | { status: "invalid" }
  | { status: "forbidden"; reason: string }
