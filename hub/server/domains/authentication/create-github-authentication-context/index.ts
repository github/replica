import { createHash } from "node:crypto"
import { z } from "zod"

import { createGitHubUserAuthenticationAdapter } from "../../../integrations/github/create-user-authentication-adapter/index.ts"
import { createSharedAuthenticationContext } from "../create-shared-authentication-context/index.ts"

const environmentSchema = z.looseObject({
  GITHUB_CLIENT_ID: z.string().min(1).max(200),
  GITHUB_CLIENT_SECRET: z.string().min(1).max(2_000),
  GITHUB_PROVIDER_REVISION: z.coerce.number().int().positive(),
})

export function createGitHubAuthenticationContext(
  environment: NodeJS.ProcessEnv,
  request: typeof globalThis.fetch = globalThis.fetch,
) {
  const parsed = environmentSchema.parse(environment)
  const shared = createSharedAuthenticationContext(environment)
  const origin = new URL(shared.applicationOrigin)
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
  return {
    adapter,
    ...shared,
    callbackIssuer: "https://github.com/login/oauth",
    callbackUri,
    configurationDigest: createHash("sha256")
      .update(adapter.canonicalPublicConfiguration)
      .digest("hex"),
    providerRevision: parsed.GITHUB_PROVIDER_REVISION,
    requiresProviderAssignmentEvidence: false,
    requiresFreshAdministratorEnrollment: false,
  }
}
