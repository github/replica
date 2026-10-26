import { createAppToken } from "#server/integrations/github/create-app-token"
import { installationTokenSchema } from "#server/integrations/github/create-installation-token/constants"
import { requestGitHub } from "#server/integrations/github/request-github"
import type { GitHubCredentials } from "#server/utils/identity-contracts/types"

export async function createInstallationToken(credentials: GitHubCredentials): Promise<string> {
  const data = await requestGitHub(
    `/app/installations/${credentials.installationId}/access_tokens`,
    createAppToken(credentials),
    "POST",
  )
  return installationTokenSchema.parse(data).token
}
