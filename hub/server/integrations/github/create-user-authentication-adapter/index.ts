import { z } from "zod"

import { GitHubProviderRequestError } from "../errors.ts"
import { listReadableInstallationRepositories } from "../list-readable-installation-repositories/index.ts"
import { requestGitHubUser } from "../request-github-user/index.ts"
import type {
  CreateGitHubUserAuthenticationAdapterInput,
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
  id: z.number().int().positive(),
  login: z.string().min(1).max(200).optional(),
  name: z.string().nullable().optional(),
})
const providerRequestTimeoutMs = 10_000

export function createGitHubUserAuthenticationAdapter(
  input: CreateGitHubUserAuthenticationAdapterInput,
): GitHubUserAuthenticationAdapter {
  const configuration = publicConfigurationSchema.parse(input.publicConfiguration)
  if (
    configuration.authorizationEndpoint !== "https://github.com/login/oauth/authorize" ||
    configuration.tokenEndpoint !== "https://github.com/login/oauth/access_token" ||
    configuration.userEndpoint !== "https://api.github.com/user"
  ) {
    throw new Error("GitHub authentication endpoints must use the approved github.com instance.")
  }
  if (!input.clientSecret || input.clientSecret.length > 2_000) {
    throw new Error("GitHub client secret must be between 1 and 2000 characters.")
  }
  if (
    input.installationId !== undefined &&
    (!Number.isSafeInteger(input.installationId) || input.installationId <= 0)
  ) {
    throw new Error("GitHub App installation ID must be a positive integer.")
  }
  const request = input.fetch ?? globalThis.fetch

  async function repositoryAccessEvidence(installationId: number, accessToken: string) {
    const repositoryAccess = await listReadableInstallationRepositories(
      request,
      installationId,
      accessToken,
    )
    return {
      providerAssignment: {
        assignmentSubject: "github_repository_access",
        issuedAt: new Date(),
        role: repositoryAccess.length ? ("MEMBER" as const) : null,
      },
      repositoryAccess,
    }
  }

  return {
    providerKey: "github",
    callbackUri: configuration.callbackUri,
    canonicalPublicConfiguration: JSON.stringify({
      authorizationEndpoint: configuration.authorizationEndpoint,
      callbackUri: configuration.callbackUri,
      clientId: configuration.clientId,
      tokenEndpoint: configuration.tokenEndpoint,
      userEndpoint: configuration.userEndpoint,
      ...(input.installationId === undefined ? {} : { installationId: input.installationId }),
    }),
    createAuthorizationUrl({ callbackUri, codeChallenge, freshAuthentication, state }) {
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
      if (freshAuthentication) url.searchParams.set("prompt", "select_account")
      return url
    },
    async completeAuthenticationProof({ callbackUri, code, codeVerifier }) {
      if (callbackUri !== configuration.callbackUri) {
        throw new Error("GitHub callback URI does not match the configured callback URI.")
      }
      let tokenResponse: Response
      try {
        tokenResponse = await request(configuration.tokenEndpoint, {
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
          signal: AbortSignal.timeout(providerRequestTimeoutMs),
        })
      } catch (error) {
        throw new GitHubProviderRequestError({ cause: error })
      }
      if (!tokenResponse.ok) throw new GitHubProviderRequestError()
      const token = tokenResponseSchema.parse(await tokenResponse.json())

      const userResponse = await requestGitHubUser(
        request,
        configuration.userEndpoint,
        token.access_token,
      )
      if (!userResponse.ok) throw new GitHubProviderRequestError()
      const user = userResponseSchema.parse(await userResponse.json())

      return {
        identity: {
          provider: "github",
          issuer: "https://github.com",
          subject: String(user.id),
        },
        ...(user.login
          ? {
              profile: {
                login: user.login,
                name: user.name?.trim().slice(0, 200) || null,
              },
            }
          : {}),
        ...(input.installationId === undefined
          ? {}
          : await repositoryAccessEvidence(input.installationId, token.access_token)),
      }
    },
  }
}
