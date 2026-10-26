import { getIdentityConfiguration } from "#server/domains/identity/get-identity-configuration"
import { getIdentityContext } from "#server/domains/identity/get-identity-context"
import type { IdentityDependencies, IdentityRecords } from "#server/utils/identity-contracts/types"
import { IdentityError } from "#server/utils/identity-error"
import { requireCsrfToken } from "#server/utils/require-csrf-token"

export async function requireIdentityAdministrator(
  dependencies: IdentityDependencies,
  token: string,
  csrfToken: string,
  records: IdentityRecords,
) {
  const { now } = dependencies

  requireCsrfToken(token, csrfToken)
  const current = await getIdentityContext(dependencies, token, records)
  if (!current.user.administrator) {
    throw new IdentityError(403, "administrator_required", "A Hub administrator is required.")
  }
  const { revision } = await getIdentityConfiguration(dependencies, records)
  const age = current.session.freshAuthorizedAt
    ? now().getTime() - current.session.freshAuthorizedAt.getTime()
    : Infinity
  if (age < 0 || age >= 5 * 60_000 || revision !== current.session.credentialRevision) {
    throw new IdentityError(
      403,
      "fresh_authorization_required",
      "Verify the same GitHub account on this browser session before continuing.",
    )
  }
  return current
}
