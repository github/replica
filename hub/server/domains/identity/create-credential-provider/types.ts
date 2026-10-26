import type { GitHubCredentials } from "#server/integrations/github/validate-github-credentials/types"
import type { IdentityState } from "#server/repositories/identity-state/types"

export interface CredentialProvider {
  name: "database" | "environment"
  read(state: IdentityState): GitHubCredentials | null
  encrypt?: (credentials: GitHubCredentials) => string
}
