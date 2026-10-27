import { createAppToken } from "#server/integrations/github/create-app-token"
import { installationTokenSchema } from "#server/integrations/github/create-installation-token/constants"
import { requestGitHubApi } from "#server/integrations/github/request-github-api"
import type { GitHubCredentials } from "#server/integrations/github/validate-github-credentials/types"

export async function createInstallationToken(credentials: GitHubCredentials): Promise<string> {
  const response = await requestGitHubApi(
    `/app/installations/${credentials.installationId}/access_tokens`,
    createAppToken(credentials),
    "POST",
  )
  return installationTokenSchema.parse(response).token
}
