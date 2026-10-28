import { createPrivateKey } from "node:crypto"

import type { GitHubCredentials } from "#server/integrations/github/validate-github-credentials/types"
import { GitHubError } from "#server/integrations/github/github-error"

import { credentialsSchema } from "#server/integrations/github/validate-github-credentials/constants"

export function validateGitHubCredentials(input: unknown): GitHubCredentials {
  const parsed = credentialsSchema.safeParse(input)
  if (!parsed.success) {
    throw new GitHubError(
      "invalid_credentials",
      "Supply the GitHub App ID, installation ID, client ID, client secret, and RSA private key.",
    )
  }

  try {
    const key = createPrivateKey(parsed.data.privateKey)
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
      throw new Error("Invalid key")
    }
  } catch {
    throw new GitHubError(
      "invalid_credentials",
      "The GitHub App private key must be an RSA key of at least 2048 bits.",
    )
  }

  return parsed.data
}
