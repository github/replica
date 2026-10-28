import type { GitHubCredentials } from "#server/integrations/github/validate-github-credentials/types"
import type { GitHubIntegrationState } from "#server/repositories/github-integration-state/types"

export interface GitHubIntegrationCredentialProvider {
  name: "database" | "environment"
  read(state: GitHubIntegrationState): GitHubCredentials | null
  encrypt?: (credentials: GitHubCredentials) => string
}
