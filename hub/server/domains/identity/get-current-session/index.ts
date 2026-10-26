import { getIdentityContext } from "#server/domains/identity/get-identity-context"
import type { IdentityDependencies } from "#server/utils/identity-contracts/types"

export async function getCurrentSession(dependencies: IdentityDependencies, token: string) {
  return getIdentityContext(dependencies, token)
}
