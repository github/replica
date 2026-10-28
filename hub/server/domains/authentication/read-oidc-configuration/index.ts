import type { OidcConfiguration } from "#server/integrations/oidc/create-client/types"

function requiredEnvironmentValue(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key]
  if (!value) throw new Error(`Set ${key} when HUB_AUTH_PROVIDER=oidc.`)
  return value
}

export function readOidcConfiguration(
  environment: NodeJS.ProcessEnv,
  origin: URL,
): OidcConfiguration {
  const enabledValue = requiredEnvironmentValue(environment, "HUB_OIDC_ENABLED")
  if (!["true", "false"].includes(enabledValue)) {
    throw new Error("HUB_OIDC_ENABLED must be true or false.")
  }
  const issuerValue = requiredEnvironmentValue(environment, "HUB_OIDC_ISSUER")
  const issuerMatch = issuerValue.match(
    /^https:\/\/login\.microsoftonline\.com\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/v2\.0\/?$/i,
  )
  const tenantId = issuerMatch?.[1]
  if (!tenantId) {
    throw new Error("HUB_OIDC_ISSUER must be https://login.microsoftonline.com/<tenant-id>/v2.0.")
  }
  const issuer = `https://login.microsoftonline.com/${tenantId.toLowerCase()}/v2.0`
  const callbackUrl = requiredEnvironmentValue(environment, "HUB_OIDC_CALLBACK_URL")
  if (callbackUrl !== `${origin.origin}/api/auth/oidc/callback`) {
    throw new Error("HUB_OIDC_CALLBACK_URL must match the Hub OIDC callback URL.")
  }
  const clientCredentialReference = requiredEnvironmentValue(
    environment,
    "HUB_OIDC_CLIENT_CREDENTIAL_REFERENCE",
  )
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(clientCredentialReference)) {
    throw new Error("HUB_OIDC_CLIENT_CREDENTIAL_REFERENCE must name an environment variable.")
  }
  const clientSecret = requiredEnvironmentValue(environment, clientCredentialReference)
  if (clientSecret.length < 16 || clientSecret.length > 4_096) {
    throw new Error("The referenced OIDC client credential must contain 16 to 4096 characters.")
  }
  const scopes = requiredEnvironmentValue(environment, "HUB_OIDC_SCOPES")
    .split(/\s+/)
    .filter(Boolean)
  if (
    !scopes.includes("openid") ||
    !scopes.includes("profile") ||
    scopes.includes("offline_access") ||
    scopes.some((scope) => !/^[\x21\x23-\x5b\x5d-\x7e]+$/.test(scope))
  ) {
    throw new Error(
      "HUB_OIDC_SCOPES must include openid and profile and must not request offline_access.",
    )
  }
  const memberRole = requiredEnvironmentValue(environment, "HUB_OIDC_MEMBER_ROLE")
  const administratorRole = requiredEnvironmentValue(environment, "HUB_OIDC_ADMINISTRATOR_ROLE")
  if (
    memberRole === administratorRole ||
    memberRole.length > 255 ||
    administratorRole.length > 255
  ) {
    throw new Error("OIDC member and administrator role values must be distinct and bounded.")
  }
  const membershipPolicy = requiredEnvironmentValue(environment, "HUB_OIDC_MEMBERSHIP_POLICY")
  if (!["jit-assignment", "invitation-required"].includes(membershipPolicy)) {
    throw new Error("HUB_OIDC_MEMBERSHIP_POLICY must be jit-assignment or invitation-required.")
  }
  const providerRevision = Number(
    requiredEnvironmentValue(environment, "HUB_OIDC_PROVIDER_REVISION"),
  )
  if (!Number.isSafeInteger(providerRevision) || providerRevision < 1) {
    throw new Error("HUB_OIDC_PROVIDER_REVISION must be a positive integer.")
  }
  if (providerRevision >= Number.MAX_SAFE_INTEGER) {
    throw new Error("HUB_OIDC_PROVIDER_REVISION must be an incrementable positive integer.")
  }
  const clientId = requiredEnvironmentValue(environment, "HUB_OIDC_CLIENT_ID")
  if (clientId.length > 255) {
    throw new Error("HUB_OIDC_CLIENT_ID must contain at most 255 characters.")
  }
  return {
    issuer,
    clientId,
    clientSecret,
    clientCredentialReference,
    callbackUrl,
    scopes,
    memberRole,
    administratorRole,
    membershipPolicy: membershipPolicy as OidcConfiguration["membershipPolicy"],
    enabled: enabledValue === "true",
    providerRevision,
  }
}
