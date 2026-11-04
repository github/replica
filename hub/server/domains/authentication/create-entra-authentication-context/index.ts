import { createHash } from "node:crypto"
import { z } from "zod"

import { createClientSecretAuthenticationProvider } from "../../../integrations/oidc/create-client-secret-authentication-provider/index.ts"
import { createManagedIdentityAuthenticationProvider } from "../../../integrations/oidc/create-managed-identity-authentication-provider/index.ts"
import { createEntraOidcUserAuthenticationAdapter } from "../../../integrations/oidc/create-user-authentication-adapter/index.ts"
import { createSharedAuthenticationContext } from "../create-shared-authentication-context/index.ts"

const entraEnvironmentSchema = z.discriminatedUnion("ENTRA_OIDC_CLIENT_AUTHENTICATION", [
  z.looseObject({
    ENTRA_OIDC_CLIENT_AUTHENTICATION: z.literal("client-secret"),
    ENTRA_OIDC_CLIENT_ID: z.uuid(),
    ENTRA_OIDC_MANAGED_IDENTITY_CLIENT_ID: z.undefined().optional(),
    ENTRA_OIDC_CLIENT_SECRET: z.string().min(1).max(4_096),
    ENTRA_OIDC_ISSUER: z.url().max(500),
    ENTRA_OIDC_PROVIDER_REVISION: z.coerce.number().int().positive(),
  }),
  z.looseObject({
    ENTRA_OIDC_CLIENT_AUTHENTICATION: z.literal("managed-identity"),
    ENTRA_OIDC_CLIENT_ID: z.uuid(),
    ENTRA_OIDC_CLIENT_SECRET: z.undefined().optional(),
    ENTRA_OIDC_ISSUER: z.url().max(500),
    ENTRA_OIDC_MANAGED_IDENTITY_CLIENT_ID: z.uuid(),
    ENTRA_OIDC_PROVIDER_REVISION: z.coerce.number().int().positive(),
  }),
])

export function createEntraAuthenticationContext(
  environment: NodeJS.ProcessEnv,
  request: typeof globalThis.fetch = globalThis.fetch,
) {
  const shared = createSharedAuthenticationContext(environment)
  const parsed = entraEnvironmentSchema.parse(environment)
  const origin = new URL(shared.applicationOrigin)
  const callbackUri = new URL("/api/auth/entra/callback", origin).toString()
  const clientAuthentication =
    parsed.ENTRA_OIDC_CLIENT_AUTHENTICATION === "client-secret"
      ? createClientSecretAuthenticationProvider({
          reference: "ENTRA_OIDC_CLIENT_SECRET",
          secret: parsed.ENTRA_OIDC_CLIENT_SECRET,
        })
      : createManagedIdentityAuthenticationProvider({
          clientId: parsed.ENTRA_OIDC_MANAGED_IDENTITY_CLIENT_ID,
        })
  const adapter = createEntraOidcUserAuthenticationAdapter({
    clientAuthentication,
    fetch: request,
    publicConfiguration: {
      callbackUri,
      clientId: parsed.ENTRA_OIDC_CLIENT_ID,
      issuer: parsed.ENTRA_OIDC_ISSUER,
      scopes: ["openid", "profile"],
    },
  })
  return {
    adapter,
    ...shared,
    callbackIssuer: parsed.ENTRA_OIDC_ISSUER.toLowerCase(),
    callbackUri,
    configurationDigest: createHash("sha256")
      .update(adapter.canonicalPublicConfiguration)
      .digest("hex"),
    providerRevision: parsed.ENTRA_OIDC_PROVIDER_REVISION,
    requiresProviderAssignmentEvidence: true,
    requiresFreshAdministratorEnrollment: true,
  }
}
