import type { GitHubUserAuthConfiguration } from "#server/integrations/github/create-user-auth-client/types"
import { accessTokenSchema } from "#server/integrations/github/exchange-user-authorization/constants"
import { AuthenticationError } from "#server/utils/authentication-error"

export async function exchangeUserAuthorization(
  configuration: GitHubUserAuthConfiguration,
  code: string,
  pkceVerifier: string,
): Promise<string> {
  let response: Response
  try {
    response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: configuration.clientId,
        client_secret: configuration.clientSecret,
        code,
        code_verifier: pkceVerifier,
        redirect_uri: configuration.callbackUrl,
      }),
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
  const parsed = accessTokenSchema.safeParse(body)
  if (!parsed.success) {
    throw new AuthenticationError(401, "github_denied", "GitHub denied authorization.")
  }
  return parsed.data.access_token
}
