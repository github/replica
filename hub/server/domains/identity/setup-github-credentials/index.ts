import { requireBootstrapSecret } from "#server/domains/identity/require-bootstrap-secret"
import { validateGitHubCredentials } from "#server/integrations/github/validate-github-credentials"
import type { IdentityDependencies } from "#server/utils/identity-contracts/types"
import { IdentityError } from "#server/utils/identity-error"

export async function setupGitHubCredentials(
  dependencies: IdentityDependencies,
  secret: string,
  input: unknown,
) {
  const { store, provider } = dependencies

  requireBootstrapSecret(dependencies, secret)
  if (!provider.encrypt) {
    throw new IdentityError(
      409,
      "credentials_read_only",
      "Configure GitHub App credentials in the selected external provider.",
    )
  }
  const encrypt = provider.encrypt
  const credentials = validateGitHubCredentials(input)
  await store.lock(async (records) => {
    if (provider.read(await records.state())) {
      throw new IdentityError(
        409,
        "already_configured",
        "Use administrator credential rotation for an existing GitHub App.",
      )
    }
    await records.saveCredentials(encrypt(credentials))
    await records.audit({ event: "credentials.setup", actorId: null, sessionId: null })
  })
}
