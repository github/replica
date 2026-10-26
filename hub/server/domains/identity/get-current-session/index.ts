import { getIdentityConfiguration } from "#server/domains/identity/get-identity-configuration"
import { getIdentityContext } from "#server/domains/identity/get-identity-context"
import type { IdentityDependencies } from "#server/utils/identity-contracts/types"

export async function getCurrentSession(dependencies: IdentityDependencies, token: string) {
  const current = await getIdentityContext(dependencies, token)
  await getIdentityConfiguration(dependencies)
  return current
}
