import type { GitHubCredentials } from "#server/utils/identity-contracts/types"
import { createAppToken } from "#server/integrations/github/create-app-token"
import { requestGitHub } from "#server/integrations/github/request-github"

import { installationTokenSchema } from "./constants.ts"

export async function createInstallationToken(credentials: GitHubCredentials): Promise<string> {
  const data = await requestGitHub(
    `/app/installations/${credentials.installationId}/access_tokens`,
    createAppToken(credentials),
    "POST",
  )
  return installationTokenSchema.parse(data).token
}
