import type { IdentityDependencies } from "#server/utils/identity-contracts/types"

export async function getProviderConfiguration(dependencies: IdentityDependencies) {
  const { settings, provider, store } = dependencies
  const state = await store.read.state()
  const githubConfigured = provider.read(state) !== null

  return {
    demoMode: settings.demoMode,
    signInProviders: settings.signInProviders.map((name) => ({
      name,
      configured: name === "oidc-demo" || githubConfigured,
    })),
    repositoryProvider: settings.repositoryProvider,
  }
}
