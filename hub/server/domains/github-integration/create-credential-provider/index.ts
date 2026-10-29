import { decryptGitHubCredentials } from "#server/integrations/github/decrypt-github-credentials"
import { encryptGitHubCredentials } from "#server/integrations/github/encrypt-github-credentials"
import { validateGitHubCredentials } from "#server/integrations/github/validate-github-credentials"
import type { GitHubIntegrationCredentialProvider } from "#server/domains/github-integration/create-credential-provider/types"

export function createGitHubIntegrationCredentialProvider(
  environment: NodeJS.ProcessEnv,
): GitHubIntegrationCredentialProvider {
  const selected = environment.HUB_GITHUB_CREDENTIAL_PROVIDER ?? "database"
  if (selected === "environment") {
    const credentials = validateGitHubCredentials({
      appId: environment.GITHUB_APP_ID,
      installationId: environment.GITHUB_INSTALLATION_ID,
      clientId: environment.GITHUB_CLIENT_ID,
      clientSecret: environment.GITHUB_CLIENT_SECRET,
      privateKey: environment.GITHUB_PRIVATE_KEY,
    })
    return { name: "environment", read: () => credentials }
  }
  if (selected !== "database") {
    throw new Error("HUB_GITHUB_CREDENTIAL_PROVIDER must be database or environment.")
  }

  const encodedKey = environment.HUB_GITHUB_CREDENTIAL_KEY
  if (!encodedKey || !/^[a-fA-F0-9]{64}$/.test(encodedKey)) {
    throw new Error(
      "Set HUB_GITHUB_CREDENTIAL_KEY to a 32-byte hexadecimal encryption key outside the database.",
    )
  }
  const key = Buffer.from(encodedKey, "hex")
  return {
    name: "database",
    read: (state) => decryptGitHubCredentials(key, state.encryptedCredentials),
    encrypt: encryptGitHubCredentials.bind(null, key),
  }
}
