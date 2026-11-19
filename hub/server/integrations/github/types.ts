export interface GitHubRepositoryEvidence {
  defaultBranch: string
  githubRepositoryId: number
  nameWithOwner: string
}

export type GitHubRepositoryAccessLevel = "READ" | "TRIAGE" | "WRITE" | "MAINTAIN" | "ADMIN"

export interface GitHubRepositoryAccessEvidence extends GitHubRepositoryEvidence {
  accessLevel: GitHubRepositoryAccessLevel
}
