import type { BuildState } from "../../../generated/prisma/client.ts"
import type { GitHubBuildRun } from "../types.ts"

export interface PrepareGitHubBuildInput {
  githubRepositoryId: number
  branchName: string
  commitSha: string
  run: GitHubBuildRun
  author: { providerUserId: string; login: string; avatarUrl: string | null } | null
}

export type PreparedGitHubBuild =
  | { status: "unknown-repository" }
  | {
      status: "ready"
      buildId: string
      state: BuildState
      distDigest: string | null
      /** False when another workflow run owns the Build, so this run must not change it. */
      ownsBuild: boolean
    }
