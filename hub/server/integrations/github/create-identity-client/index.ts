import type { GitHubIdentityClient } from "#server/utils/identity-contracts/types"
import { createAuthorizationUrl } from "#server/integrations/github/create-authorization-url"
import { createInstallationToken } from "#server/integrations/github/create-installation-token"
import { getRepositoryPermission } from "#server/integrations/github/get-repository-permission"
import { identifyUser } from "#server/integrations/github/identify-user"
import { isUserAdmitted } from "#server/integrations/github/is-user-admitted"

export function createGitHubIdentityClient(origin: string): GitHubIdentityClient {
  return {
    validate: async (credentials) => {
      await createInstallationToken(credentials)
    },
    authorize: createAuthorizationUrl.bind(null, origin),
    identify: identifyUser.bind(null, origin),
    admitted: isUserAdmitted,
    permission: getRepositoryPermission,
  }
}
