import type { IdentityStore } from "#server/domains/identity/create-store/types"
import type { OidcConfiguration } from "#server/integrations/oidc/create-client/types"
import { digestSecret } from "#server/utils/digest-secret"

import type { Prisma } from "../../../generated/prisma/client.ts"

function storedConfiguration(configuration: OidcConfiguration): Prisma.InputJsonObject {
  return {
    clientId: configuration.clientId,
    callbackUrl: configuration.callbackUrl,
    clientCredentialReference: configuration.clientCredentialReference,
    credentialFingerprint: digestSecret(configuration.clientSecret),
    scopes: configuration.scopes,
    memberRole: configuration.memberRole,
    administratorRole: configuration.administratorRole,
    membershipPolicy: configuration.membershipPolicy,
  }
}

function matches(value: unknown, expected: Prisma.InputJsonObject): boolean {
  return JSON.stringify(value) === JSON.stringify(expected)
}

export function ensureOidcProviderRevision(store: IdentityStore, configuration: OidcConfiguration) {
  return store.lock(async (records) => {
    const latest = await records.latestAuthenticationProviderRevision("oidc")
    const stored = storedConfiguration(configuration)
    if (latest && latest.revision > configuration.providerRevision) {
      throw new Error("HUB_OIDC_PROVIDER_REVISION cannot roll back an existing provider.")
    }
    if (latest?.revision === configuration.providerRevision) {
      if (
        latest.authenticationProvider.type !== "oidc" ||
        latest.issuer !== configuration.issuer ||
        latest.authenticationProvider.enabled !== configuration.enabled ||
        !matches(latest.configuration, stored)
      ) {
        throw new Error("HUB_OIDC_PROVIDER_REVISION must increase when OIDC configuration changes.")
      }
      return latest
    }
    return records.createAuthenticationProviderRevision({
      key: "oidc",
      type: "oidc",
      enabled: configuration.enabled,
      revision: configuration.providerRevision,
      issuer: configuration.issuer,
      configuration: stored,
    })
  })
}
