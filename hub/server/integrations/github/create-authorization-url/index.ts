import { createHash } from "node:crypto"

import type { GitHubCredentials } from "#server/utils/identity-contracts/types"

export function createAuthorizationUrl(
  origin: string,
  credentials: GitHubCredentials,
  state: string,
  verifier: string,
): string {
  const url = new URL("https://github.com/login/oauth/authorize")
  url.search = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: `${origin}/api/auth/github/callback`,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString()
  return url.href
}
