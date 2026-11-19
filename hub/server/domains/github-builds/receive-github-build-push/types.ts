import type { createGitHubActionsClient } from "../../../integrations/github/create-github-actions-client/index.ts"
import type { GitHubBuildImportDependencies } from "../types.ts"

export interface ReceiveGitHubBuildPushDependencies extends GitHubBuildImportDependencies {
  client: Pick<ReturnType<typeof createGitHubActionsClient>, "getWorkflowRun">
}

export type ReceiveGitHubBuildPushResult =
  | { status: "imported" | "unchanged"; buildId: string }
  | { status: "failed"; buildId: string; reason: string }
  | { status: "unknown-repository" | "unavailable" }
  | { status: "rejected"; reason: string }
