import type { GitHubCredentials } from "#server/integrations/github/validate-github-credentials/types"
import type { GitHubIntegrationCredentials } from "#server/repositories/github-integration-credentials/types"

export interface GitHubIntegrationCredentialProvider {
  name: "database" | "environment"
  read(state: GitHubIntegrationCredentials): GitHubCredentials | null
  encrypt?: (credentials: GitHubCredentials) => string
}
