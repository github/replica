import { z } from "zod"

import type { GitHubAuthenticationConfiguration } from "../create-github-authentication-services/types.ts"

const configurationSchema = z
  .object({
    appOrigin: z.url(),
    authorizationEndpoint: z.url(),
    callbackUri: z.url(),
    clientId: z.string().min(1).max(200),
    clientSecret: z.string().min(1).max(2_000),
    encryptionKey: z.string().min(1).max(100),
    provider: z.literal("github"),
    revision: z.coerce.number().int().positive(),
    secureCookies: z.enum(["true", "false"]),
    tokenEndpoint: z.url(),
    userEndpoint: z.url(),
  })
  .strict()

export function readGitHubAuthenticationConfiguration(
  environment: NodeJS.ProcessEnv,
): GitHubAuthenticationConfiguration | null {
  if (!environment.AUTHENTICATION_PROVIDER) return null
  const parsed = configurationSchema.parse({
    appOrigin: environment.HUB_APP_ORIGIN,
    authorizationEndpoint: environment.GITHUB_AUTHORIZATION_ENDPOINT,
    callbackUri: environment.GITHUB_CALLBACK_URI,
    clientId: environment.GITHUB_CLIENT_ID,
    clientSecret: environment.GITHUB_CLIENT_SECRET,
    encryptionKey: environment.AUTHENTICATION_ENCRYPTION_KEY,
    provider: environment.AUTHENTICATION_PROVIDER,
    revision: environment.GITHUB_AUTHENTICATION_REVISION,
    secureCookies: environment.AUTHENTICATION_SECURE_COOKIES,
    tokenEndpoint: environment.GITHUB_TOKEN_ENDPOINT,
    userEndpoint: environment.GITHUB_USER_ENDPOINT,
  })
  const encryptionKey = Buffer.from(parsed.encryptionKey, "base64url")
  if (encryptionKey.length !== 32) {
    throw new Error("AUTHENTICATION_ENCRYPTION_KEY must decode to 32 bytes.")
  }
  return {
    appOrigin: parsed.appOrigin,
    clientSecret: parsed.clientSecret,
    encryptionKey,
    revision: parsed.revision,
    secureCookies: parsed.secureCookies === "true",
    publicConfiguration: {
      authorizationEndpoint: parsed.authorizationEndpoint,
      callbackUri: parsed.callbackUri,
      clientId: parsed.clientId,
      tokenEndpoint: parsed.tokenEndpoint,
      userEndpoint: parsed.userEndpoint,
    },
  }
}
