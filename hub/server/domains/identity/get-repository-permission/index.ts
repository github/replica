import { getIdentityConfiguration } from "#server/domains/identity/get-identity-configuration"
import { getIdentityContext } from "#server/domains/identity/get-identity-context"
import type { IdentityDependencies } from "#server/utils/identity-contracts/types"
import { IdentityError } from "#server/utils/identity-error"

export async function getRepositoryPermission(
  dependencies: IdentityDependencies,
  token: string,
  owner: string,
  repository: string,
) {
  const { store, github } = dependencies

  const current = await getIdentityContext(dependencies, token)
  const configuration = await getIdentityConfiguration(dependencies)
  const permission = await github.permission(
    configuration.credentials,
    {
      providerId: current.user.providerId,
      login: current.user.login,
      name: current.user.name,
      avatarUrl: current.user.avatarUrl,
    },
    owner,
    repository,
  )
  await store.lock(async (records) => {
    await getIdentityContext(dependencies, token, records)
    if (
      (await getIdentityConfiguration(dependencies, records)).revision !== configuration.revision
    ) {
      throw new IdentityError(
        503,
        "credentials_changed",
        "GitHub App credentials changed. Retry the access check.",
      )
    }
  })
  return permission
}
