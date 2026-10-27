import type { GitHubUserProfile } from "#server/integrations/github/create-user-auth-client/types"
import { githubUserSchema } from "#server/integrations/github/request-github-user/constants"
import { AuthenticationError } from "#server/utils/authentication-error"

export async function requestGitHubUser(accessToken: string): Promise<GitHubUserProfile> {
  let response: Response
  try {
    response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    })
  } catch {
    throw new AuthenticationError(503, "github_unavailable", "GitHub is unavailable.")
  }
  if (!response.ok) {
    throw new AuthenticationError(503, "github_unavailable", "GitHub is unavailable.")
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new AuthenticationError(503, "github_invalid_response", "GitHub returned invalid data.")
  }
  const parsed = githubUserSchema.safeParse(body)
  if (!parsed.success) {
    throw new AuthenticationError(503, "github_invalid_response", "GitHub returned invalid data.")
  }
  return {
    subject: String(parsed.data.id),
    username: parsed.data.login,
    displayName: parsed.data.name,
    avatarUrl: parsed.data.avatar_url,
  }
}
