export interface ConnectedRepositoryEvidence {
  defaultBranch: string
  githubRepositoryId: number
  nameWithOwner: string
}

export interface RepositoryAccessEvidence extends ConnectedRepositoryEvidence {
  accessLevel: "READ" | "TRIAGE" | "WRITE" | "MAINTAIN" | "ADMIN"
}
