import { createHash } from "node:crypto"

import type { GitHubUserAuthConfiguration } from "#server/integrations/github/create-user-auth-client/types"

export function createUserAuthorizationUrl(
  configuration: GitHubUserAuthConfiguration,
  state: string,
  pkceVerifier: string,
): string {
  const url = new URL("https://github.com/login/oauth/authorize")
  url.search = new URLSearchParams({
    client_id: configuration.clientId,
    redirect_uri: configuration.callbackUrl,
    state,
    code_challenge: createHash("sha256").update(pkceVerifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString()
  return url.href
}
