import { createHash } from "node:crypto"
import { z } from "zod"

import { createClientSecretAuthenticationProvider } from "../../../integrations/oidc/create-client-secret-authentication-provider/index.ts"
import { createManagedIdentityAuthenticationProvider } from "../../../integrations/oidc/create-managed-identity-authentication-provider/index.ts"
import { createEntraOidcUserAuthenticationAdapter } from "../../../integrations/oidc/create-user-authentication-adapter/index.ts"

const sharedEnvironmentSchema = z.looseObject({
  HUB_APPLICATION_ORIGIN: z.url().max(500),
  HUB_AUTHENTICATION_ENCRYPTION_KEY: z.string().min(1),
  HUB_BOOTSTRAP_SECRET: z.string().min(32).max(2_000),
})
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

function parseApplicationOrigin(value: string) {
  const origin = new URL(value)
  if (
    origin.origin !== value ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "http:" && origin.protocol !== "https:")
  ) {
    throw new Error("HUB_APPLICATION_ORIGIN must be an exact HTTP origin without a trailing slash.")
  }
  const loopbackHosts = new Set(["127.0.0.1", "::1", "[::1]", "localhost"])
  if (origin.protocol !== "https:" && !loopbackHosts.has(origin.hostname)) {
    throw new Error("HUB_APPLICATION_ORIGIN must use HTTPS outside loopback development.")
  }
  return origin
}

export function createEntraAuthenticationContext(
  environment: NodeJS.ProcessEnv,
  request: typeof globalThis.fetch = globalThis.fetch,
) {
  const shared = sharedEnvironmentSchema.parse(environment)
  const parsed = entraEnvironmentSchema.parse(environment)
  const origin = parseApplicationOrigin(shared.HUB_APPLICATION_ORIGIN)
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
  const encryptionKey = Buffer.from(shared.HUB_AUTHENTICATION_ENCRYPTION_KEY, "base64")
  if (encryptionKey.length !== 32) {
    throw new Error("HUB_AUTHENTICATION_ENCRYPTION_KEY must decode to exactly 32 bytes.")
  }
  return {
    adapter,
    applicationOrigin: origin.origin,
    bootstrapSecret: shared.HUB_BOOTSTRAP_SECRET,
    callbackIssuer: parsed.ENTRA_OIDC_ISSUER.toLowerCase(),
    callbackUri,
    configurationDigest: createHash("sha256")
      .update(adapter.canonicalPublicConfiguration)
      .digest("hex"),
    encryptionKey,
    providerRevision: parsed.ENTRA_OIDC_PROVIDER_REVISION,
    secureCookie: origin.protocol === "https:",
  }
}
