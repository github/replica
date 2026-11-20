import type { createGitHubActionsClient } from "../../../integrations/github/create-github-actions-client/index.ts"
import type { GitHubBuildImportDependencies } from "../types.ts"

export interface ImportGitHubWorkflowRunDependencies extends GitHubBuildImportDependencies {
  client: Pick<
    ReturnType<typeof createGitHubActionsClient>,
    "getWorkflowRun" | "getCommitAuthor" | "listRunArtifacts" | "downloadArtifact"
  >
}

export interface ImportGitHubWorkflowRunResult {
  dist: "ignored" | "pending" | "imported" | "unchanged" | "failed"
  screenshots: "absent" | "attached" | "not-ready" | "digest-mismatch" | "invalid"
}
