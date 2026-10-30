import { parseProviderKey } from "../../../utils/parse-provider-key/index.ts"
import { ProviderRevisionInvariantError } from "../errors.ts"
import type { GetSelectedProviderRevisionDependencies } from "./types.ts"

export async function getSelectedProviderRevision(
  providerKey: string,
  dependencies: GetSelectedProviderRevisionDependencies,
) {
  const provider = await dependencies.findAuthenticationProvider(parseProviderKey(providerKey))
  if (!provider) return null
  if (!provider.selectedRevision) {
    throw new ProviderRevisionInvariantError(
      "The authentication provider does not have a selected revision.",
    )
  }
  if (provider.selectedRevision.providerId !== provider.id) {
    throw new ProviderRevisionInvariantError(
      "The selected revision does not belong to the authentication provider.",
    )
  }
  return provider.selectedRevision
}
