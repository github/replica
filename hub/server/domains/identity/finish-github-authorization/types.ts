import type { GitHubProfile, OAuthAttempt } from "#server/utils/identity-contracts/types"

export interface VerifiedGitHubAuthorization {
  attempt: OAuthAttempt
  profile: GitHubProfile
  verifiedAt: Date
  admitted: boolean
}
