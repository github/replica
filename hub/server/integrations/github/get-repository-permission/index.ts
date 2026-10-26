import type {
  GitHubCredentials,
  GitHubProfile,
  RepositoryPermission,
} from "#server/utils/identity-contracts/types"
import { createAppToken } from "#server/integrations/github/create-app-token"
import { createInstallationToken } from "#server/integrations/github/create-installation-token"
import { getCollaboratorPermission } from "#server/integrations/github/get-collaborator-permission"
import { GitHubResponseError } from "#server/integrations/github/github-response-error"
import { requestGitHub } from "#server/integrations/github/request-github"

import { installationSchema } from "./constants.ts"

export async function getRepositoryPermission(
  credentials: GitHubCredentials,
  profile: GitHubProfile,
  owner: string,
  repository: string,
): Promise<RepositoryPermission> {
  const fullName = `${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`
  let data: unknown
  try {
    data = await requestGitHub(`/repos/${fullName}/installation`, createAppToken(credentials))
  } catch (error) {
    if (error instanceof GitHubResponseError && error.upstreamStatus === 404) return "none"
    throw error
  }
  const installation = installationSchema.parse(data)
  return getCollaboratorPermission(
    await createInstallationToken(credentials, installation.id),
    profile,
    fullName,
  )
}
