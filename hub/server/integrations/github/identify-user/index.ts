import { GitHubResponseError } from "#server/integrations/github/github-response-error"
import {
  accessTokenSchema,
  profileSchema,
} from "#server/integrations/github/identify-user/constants"
import { requestGitHub } from "#server/integrations/github/request-github"
import type { GitHubCredentials, GitHubProfile } from "#server/utils/identity-contracts/types"
import { IdentityError } from "#server/utils/identity-error"

export async function identifyUser(
  origin: string,
  credentials: GitHubCredentials,
  code: string,
  verifier: string,
): Promise<GitHubProfile> {
  let response: Response
  try {
    response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        code_verifier: verifier,
        redirect_uri: `${origin}/api/auth/github/callback`,
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    })
  } catch {
    throw new GitHubResponseError(0)
  }
  if (!response.ok) throw new GitHubResponseError(response.status)
  const result = accessTokenSchema.safeParse(await response.json())
  if (!result.success) {
    throw new IdentityError(
      401,
      "github_sign_in_failed",
      "GitHub did not authorize this sign-in. Start again.",
    )
  }
  const profile = profileSchema.parse(await requestGitHub("/user", result.data.access_token))
  return {
    providerId: String(profile.id),
    login: profile.login,
    name: profile.name,
    avatarUrl: profile.avatar_url,
  }
}
