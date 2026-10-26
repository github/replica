import { getIdentityConfiguration } from "#server/domains/identity/get-identity-configuration"
import { requireIdentityAdministrator } from "#server/domains/identity/require-identity-administrator"
import { validateGitHubCredentials } from "#server/integrations/github/validate-github-credentials"
import type { IdentityDependencies } from "#server/utils/identity-contracts/types"
import { IdentityError } from "#server/utils/identity-error"

export async function rotateGitHubCredentials(
  dependencies: IdentityDependencies,
  token: string,
  csrfToken: string,
  input: unknown,
) {
  const { store, provider, github } = dependencies

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
    const current = await requireIdentityAdministrator(dependencies, token, csrfToken, records)
    const existing = await getIdentityConfiguration(dependencies, records)
    if (
      existing.credentials.appId !== credentials.appId ||
      existing.credentials.clientId !== credentials.clientId ||
      existing.credentials.installationId !== credentials.installationId
    ) {
      throw new IdentityError(
        400,
        "different_app",
        "Credential rotation must retain the existing GitHub App, client ID, and installation ID.",
      )
    }
    await github.validate(credentials)
    await records.saveCredentials(encrypt(credentials))
    await records.invalidateFreshness()
    await records.advanceGeneration()
    await records.audit({
      event: "credentials.rotate",
      actorId: current.user.id,
      sessionId: current.session.id,
    })
  })
}
