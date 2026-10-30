import { z } from "zod"

import type {
  ImmutableIdentityEvidence,
  PublicIdentityAttributes,
} from "../../../domains/authentication/types.ts"
import type {
  CreateGitHubUserAuthenticationAdapterInput,
  GitHubAuthenticationPublicConfiguration,
  GitHubUserAuthenticationAdapter,
} from "./types.ts"

const publicConfigurationSchema = z
  .object({
    authorizationEndpoint: z.url().max(500),
    callbackUri: z.url().max(500),
    clientId: z.string().min(1).max(200),
    tokenEndpoint: z.url().max(500),
    userEndpoint: z.url().max(500),
  })
  .strict()

const tokenResponseSchema = z.looseObject({
  access_token: z.string().min(1).max(2_000),
  token_type: z.literal("bearer"),
})

const userResponseSchema = z.looseObject({
  avatar_url: z.url().max(2_000).nullable(),
  email: z.email().max(320).nullable(),
  id: z.number().int().positive(),
  login: z.string().min(1).max(100),
  name: z.string().min(1).max(200).nullable(),
})

function assertHttpsProviderUrl(value: string, field: string): void {
  if (new URL(value).protocol !== "https:") {
    throw new Error(`GitHub ${field} must use HTTPS.`)
  }
}

function canonicalize(configuration: GitHubAuthenticationPublicConfiguration): string {
  return JSON.stringify({
    authorizationEndpoint: configuration.authorizationEndpoint,
    callbackUri: configuration.callbackUri,
    clientId: configuration.clientId,
    tokenEndpoint: configuration.tokenEndpoint,
    userEndpoint: configuration.userEndpoint,
  })
}

function attributes(input: z.infer<typeof userResponseSchema>): PublicIdentityAttributes {
  return {
    avatarUrl: input.avatar_url,
    email: input.email,
    login: input.login,
    name: input.name,
  }
}

export function createGitHubUserAuthenticationAdapter(
  input: CreateGitHubUserAuthenticationAdapterInput,
): GitHubUserAuthenticationAdapter {
  const configuration = publicConfigurationSchema.parse(input.publicConfiguration)
  assertHttpsProviderUrl(configuration.authorizationEndpoint, "authorization endpoint")
  assertHttpsProviderUrl(configuration.tokenEndpoint, "token endpoint")
  assertHttpsProviderUrl(configuration.userEndpoint, "user endpoint")
  if (!input.clientSecret || input.clientSecret.length > 2_000) {
    throw new Error("GitHub client secret must be present and bounded.")
  }
  const request = input.fetch ?? globalThis.fetch

  return {
    providerKey: "github",
    callbackUri: configuration.callbackUri,
    canonicalPublicConfiguration: canonicalize(configuration),
    createAuthorizationUrl({ callbackUri, codeChallenge, state }) {
      if (callbackUri !== configuration.callbackUri) {
        throw new Error("GitHub callback URI does not match the configured callback URI.")
      }
      const url = new URL(configuration.authorizationEndpoint)
      url.search = new URLSearchParams({
        client_id: configuration.clientId,
        redirect_uri: callbackUri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      }).toString()
      return url
    },
    async completeAuthenticationProof({
      callbackUri,
      code,
      codeVerifier,
    }): Promise<ImmutableIdentityEvidence> {
      if (callbackUri !== configuration.callbackUri) {
        throw new Error("GitHub callback URI does not match the configured callback URI.")
      }
      const tokenResponse = await request(configuration.tokenEndpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: configuration.clientId,
          client_secret: input.clientSecret,
          code,
          code_verifier: codeVerifier,
          redirect_uri: callbackUri,
        }),
        redirect: "error",
      })
      if (!tokenResponse.ok) throw new Error("GitHub rejected the authorization code.")
      const token = tokenResponseSchema.parse(await tokenResponse.json())

      const userResponse = await request(configuration.userEndpoint, {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token.access_token}`,
          "x-github-api-version": "2022-11-28",
        },
        redirect: "error",
      })
      if (!userResponse.ok) throw new Error("GitHub did not return the authenticated user.")
      const user = userResponseSchema.parse(await userResponse.json())

      return {
        provider: "github",
        issuer: "https://github.com",
        subject: String(user.id),
        attributes: attributes(user),
      }
    },
  }
}
