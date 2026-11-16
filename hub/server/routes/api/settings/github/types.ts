import type {
  GitHubConfigurationStatus,
  GitHubSettingKey,
  GitHubSettingState,
} from "../../../../domains/authentication/read-github-app-configuration/types.ts"
import type { GitHubConnectionCheck } from "../../../../integrations/github/test-github-app-connection/types.ts"

export interface GitHubSetupStatus {
  status: GitHubConfigurationStatus
  signInEnabled: boolean
  settings: { key: GitHubSettingKey; state: GitHubSettingState }[]
  urls: { homepage: string; callback: string; setup: string; webhook: string }
  connectedRepositories: string[]
}

export type GitHubSetupAccess =
  | { allowed: true; membershipId: string | null }
  | { allowed: false; requires: "administrator" | "bootstrap" }

export interface GitHubSetupRouteDependencies {
  applicationOrigin: string
  authorize(input: { sessionDigest?: string; bootstrapSecret?: string }): Promise<GitHubSetupAccess>
  checkRateLimit(operation: "github_setup" | "github_test", subjectDigest: string): Promise<boolean>
  readStatus(): Promise<GitHubSetupStatus>
  testConnection(): Promise<GitHubConnectionCheck[] | null>
  /** Records the installation's repositories and returns their names. */
  syncRepositories(): Promise<string[]>
  writeTestAudit(input: { actorMembershipId: string | null; failedChecks: string[] }): Promise<void>
}
