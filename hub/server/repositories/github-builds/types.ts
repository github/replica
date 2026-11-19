export interface GitHubBuildRun {
  runId: bigint
  runAttempt: number
  workflowUrl: string
  createdAt: Date
}

export interface StoredGitHubBuildArtifact {
  path: string
  kind: "dist" | "screenshot" | "manifest"
  storageKey: string
  byteLength: number
}
