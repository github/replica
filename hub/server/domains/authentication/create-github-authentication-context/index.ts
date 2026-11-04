import { createHash } from "node:crypto"
import { z } from "zod"

import { createGitHubUserAuthenticationAdapter } from "../../../integrations/github/create-user-authentication-adapter/index.ts"

const environmentSchema = z.looseObject({
  GITHUB_CLIENT_ID: z.string().min(1).max(200),
  GITHUB_CLIENT_SECRET: z.string().min(1).max(2_000),
  GITHUB_PROVIDER_REVISION: z.coerce.number().int().positive(),
  HUB_APPLICATION_ORIGIN: z.url().max(500),
  HUB_AUTHENTICATION_ENCRYPTION_KEY: z.string().min(1),
  HUB_BOOTSTRAP_SECRET: z.string().min(32).max(2_000),
})

export function createGitHubAuthenticationContext(
  environment: NodeJS.ProcessEnv,
  request: typeof globalThis.fetch = globalThis.fetch,
) {
  const parsed = environmentSchema.parse(environment)
  const origin = new URL(parsed.HUB_APPLICATION_ORIGIN)
  if (
    origin.origin !== parsed.HUB_APPLICATION_ORIGIN ||
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
  const callbackUri = new URL("/api/auth/github/callback", origin).toString()
  const adapter = createGitHubUserAuthenticationAdapter({
    clientSecret: parsed.GITHUB_CLIENT_SECRET,
    fetch: request,
    publicConfiguration: {
      authorizationEndpoint: "https://github.com/login/oauth/authorize",
      callbackUri,
      clientId: parsed.GITHUB_CLIENT_ID,
      tokenEndpoint: "https://github.com/login/oauth/access_token",
      userEndpoint: "https://api.github.com/user",
    },
  })
  const encryptionKey = Buffer.from(parsed.HUB_AUTHENTICATION_ENCRYPTION_KEY, "base64")
  if (encryptionKey.length !== 32) {
    throw new Error("HUB_AUTHENTICATION_ENCRYPTION_KEY must decode to exactly 32 bytes.")
  }
  return {
    adapter,
    applicationOrigin: origin.origin,
    bootstrapSecret: parsed.HUB_BOOTSTRAP_SECRET,
    callbackIssuer: "https://github.com/login/oauth",
    callbackUri,
    configurationDigest: createHash("sha256")
      .update(adapter.canonicalPublicConfiguration)
      .digest("hex"),
    encryptionKey,
    providerRevision: parsed.GITHUB_PROVIDER_REVISION,
    secureCookie: origin.protocol === "https:",
  }
}
