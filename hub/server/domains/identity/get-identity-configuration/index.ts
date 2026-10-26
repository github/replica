import { digestSecret } from "#server/utils/digest-secret"
import type { IdentityDependencies } from "#server/utils/identity-contracts/types"
import { IdentityError } from "#server/utils/identity-error"

export async function getIdentityConfiguration(
  dependencies: IdentityDependencies,
  records = dependencies.store.read,
) {
  const { provider } = dependencies

  const state = await records.state()
  const credentials = provider.read(state)
  if (!credentials) {
    throw new IdentityError(503, "setup_required", "Configure the GitHub App before signing in.")
  }
  return { state, credentials, revision: digestSecret(JSON.stringify(credentials)) }
}
