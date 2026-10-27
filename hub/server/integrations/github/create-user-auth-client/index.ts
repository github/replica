import { createUserAuthorizationUrl } from "#server/integrations/github/create-user-authorization-url"
import type {
  GitHubUserAuthClient,
  GitHubUserAuthConfiguration,
} from "#server/integrations/github/create-user-auth-client/types"
import { exchangeUserAuthorization } from "#server/integrations/github/exchange-user-authorization"
import { requestGitHubUser } from "#server/integrations/github/request-github-user"

export function createGitHubUserAuthClient(
  configuration: GitHubUserAuthConfiguration,
): GitHubUserAuthClient {
  return {
    authorizationUrl: createUserAuthorizationUrl.bind(null, configuration),
    identify: async (code, pkceVerifier) =>
      requestGitHubUser(await exchangeUserAuthorization(configuration, code, pkceVerifier)),
  }
}
