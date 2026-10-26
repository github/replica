import type { GitHubIdentityClient } from "#server/utils/identity-contracts/types"
import { createAuthorizationUrl } from "#server/integrations/github/create-authorization-url"
import { getRepositoryPermission } from "#server/integrations/github/get-repository-permission"
import { identifyUser } from "#server/integrations/github/identify-user"
import { isUserAdmitted } from "#server/integrations/github/is-user-admitted"

export function createGitHubIdentityClient(origin: string): GitHubIdentityClient {
  return {
    authorize: createAuthorizationUrl.bind(null, origin),
    identify: identifyUser.bind(null, origin),
    admitted: isUserAdmitted,
    permission: getRepositoryPermission,
  }
}
