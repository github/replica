import type { IdentityStore } from "#server/domains/identity/create-store/types"
import type { OidcConfiguration } from "#server/integrations/oidc/create-client/types"
import { digestSecret } from "#server/utils/digest-secret"
import { z } from "zod"

import type { Prisma } from "../../../generated/prisma/client.ts"

const storedConfigurationSchema = z
  .object({
    clientId: z.string(),
    callbackUrl: z.string(),
    clientCredentialReference: z.string(),
    credentialFingerprint: z.string(),
    scopes: z.array(z.string()),
    memberRole: z.string(),
    administratorRole: z.string(),
    membershipPolicy: z.enum(["jit-assignment", "invitation-required"]),
  })
  .strict()

function canonicalScopes(scopes: string[]): string[] {
  return [...new Set(scopes)].sort()
}

function storedConfiguration(configuration: OidcConfiguration): Prisma.InputJsonObject {
  return {
    clientId: configuration.clientId,
    callbackUrl: configuration.callbackUrl,
    clientCredentialReference: configuration.clientCredentialReference,
    credentialFingerprint: digestSecret(configuration.clientSecret),
    scopes: canonicalScopes(configuration.scopes),
    memberRole: configuration.memberRole,
    administratorRole: configuration.administratorRole,
    membershipPolicy: configuration.membershipPolicy,
  }
}

function matches(value: unknown, expected: Prisma.InputJsonObject): boolean {
  const parsedValue = storedConfigurationSchema.safeParse(value)
  const parsedExpected = storedConfigurationSchema.safeParse(expected)
  if (!parsedValue.success || !parsedExpected.success) return false
  return (
    parsedValue.data.clientId === parsedExpected.data.clientId &&
    parsedValue.data.callbackUrl === parsedExpected.data.callbackUrl &&
    parsedValue.data.clientCredentialReference === parsedExpected.data.clientCredentialReference &&
    parsedValue.data.credentialFingerprint === parsedExpected.data.credentialFingerprint &&
    parsedValue.data.memberRole === parsedExpected.data.memberRole &&
    parsedValue.data.administratorRole === parsedExpected.data.administratorRole &&
    parsedValue.data.membershipPolicy === parsedExpected.data.membershipPolicy &&
    canonicalScopes(parsedValue.data.scopes).join("\0") ===
      canonicalScopes(parsedExpected.data.scopes).join("\0")
  )
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
