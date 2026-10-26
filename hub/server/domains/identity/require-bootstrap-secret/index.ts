import type { IdentityDependencies } from "#server/utils/identity-contracts/types"
import { IdentityError } from "#server/utils/identity-error"
import { secretsMatch } from "#server/utils/secrets-match"

export function requireBootstrapSecret(
  dependencies: IdentityDependencies,
  secret: string | undefined,
) {
  const { settings } = dependencies

  if (!secret || !settings.bootstrapSecret || !secretsMatch(secret, settings.bootstrapSecret)) {
    throw new IdentityError(403, "bootstrap_denied", "The deployment bootstrap secret is required.")
  }
}
