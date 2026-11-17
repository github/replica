export interface PrepareLocalBuildInput {
  repositoryPath: string
  repositoryName: string
  defaultBranch: string
  branchName: string
  commitSha: string
  authorName: string | null
  authorEmail: string | null
  authoredAt: Date
  localUserId: string
}

export type PreparedLocalBuild =
  | {
      status: "unchanged"
      buildId: string
      buildState: "queued" | "running" | "failed" | "successful" | "superseded"
    }
  | {
      status: "queued"
      repositoryId: string
      prototypeId: string
      buildId: string
      buildNumber: number
    }
