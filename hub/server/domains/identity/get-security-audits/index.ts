import { getIdentityContext } from "#server/domains/identity/get-identity-context"
import type { IdentityDependencies } from "#server/utils/identity-contracts/types"
import { IdentityError } from "#server/utils/identity-error"

export async function getSecurityAudits(dependencies: IdentityDependencies, token: string) {
  const { store } = dependencies

  return store.lock(async (records) => {
    const current = await getIdentityContext(dependencies, token, records)
    if (!current.user.administrator) {
      throw new IdentityError(403, "administrator_required", "A Hub administrator is required.")
    }
    return records.audits()
  })
}
