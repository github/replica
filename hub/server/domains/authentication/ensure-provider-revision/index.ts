import type { IdentityStore } from "#server/domains/identity/create-store/types"
import type { GitHubUserAuthConfiguration } from "#server/integrations/github/create-user-auth-client/types"
import { digestSecret } from "#server/utils/digest-secret"

function storedConfiguration(configuration: GitHubUserAuthConfiguration): Record<string, string> {
  return {
    clientId: configuration.clientId,
    callbackUrl: configuration.callbackUrl,
    fingerprint: digestSecret(
      `${configuration.clientId}\0${configuration.clientSecret}\0${configuration.callbackUrl}`,
    ),
  }
}

function matches(value: unknown, expected: Record<string, string>): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return (
    "clientId" in value &&
    value.clientId === expected.clientId &&
    "callbackUrl" in value &&
    value.callbackUrl === expected.callbackUrl &&
    "fingerprint" in value &&
    value.fingerprint === expected.fingerprint
  )
}

export function ensureGitHubProviderRevision(
  store: IdentityStore,
  configuration: GitHubUserAuthConfiguration,
) {
  return store.lock(async (records) => {
    const current = await records.currentAuthenticationProviderRevision("github")
    const stored = storedConfiguration(configuration)
    if (
      current?.authenticationProvider.type === "github" &&
      current.issuer === configuration.issuer &&
      matches(current.configuration, stored)
    ) {
      return current
    }
    return records.createAuthenticationProviderRevision({
      key: "github",
      type: "github",
      enabled: true,
      revision: (current?.revision ?? 0) + 1,
      issuer: configuration.issuer,
      configuration: stored,
    })
  })
}
