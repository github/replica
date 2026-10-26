import type {
  GitHubCredentials,
  GitHubProfile,
  RepositoryPermission,
} from "#server/utils/identity-contracts/types"
import { createInstallationToken } from "#server/integrations/github/create-installation-token"
import { getCollaboratorPermission } from "#server/integrations/github/get-collaborator-permission"

export async function getRepositoryPermission(
  credentials: GitHubCredentials,
  profile: GitHubProfile,
  owner: string,
  repository: string,
): Promise<RepositoryPermission> {
  const fullName = `${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`
  return getCollaboratorPermission(await createInstallationToken(credentials), profile, fullName)
}
