import type { ReceiveGitHubBuildPushResult } from "../../../../domains/github-builds/receive-github-build-push/types.ts"
import type {
  GitHubActionsRunIdentity,
  GitHubActionsTokenResult,
} from "../../../../integrations/github/verify-github-actions-token/types.ts"

export interface GitHubActionsRouteDependencies {
  verifyToken(token: string): Promise<GitHubActionsTokenResult>
  receiveBuild(run: GitHubActionsRunIdentity, bytes: Buffer): Promise<ReceiveGitHubBuildPushResult>
  receiveScreenshots(
    run: GitHubActionsRunIdentity,
    bytes: Buffer,
  ): Promise<{
    status: "attached" | "not-ready" | "digest-mismatch" | "invalid"
    reason?: string
  }>
}

export interface GitHubActionsLocals {
  run: GitHubActionsRunIdentity
}
