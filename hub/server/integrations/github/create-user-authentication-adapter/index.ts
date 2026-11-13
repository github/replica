import { z } from "zod"

import { GitHubProviderRequestError } from "../errors.ts"
import type {
  CreateGitHubUserAuthenticationAdapterInput,
  GitHubUserAuthenticationAdapter,
  RepositoryAccessEvidence,
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
const installationRepositoriesResponseSchema = z.looseObject({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(
    z.looseObject({
      default_branch: z.string().min(1).max(255),
      full_name: z.string().min(3).max(255),
      id: z.number().int().positive(),
    }),
  ),
})
const providerRequestTimeoutMs = 10_000
const installationRepositoriesPageSize = 100
const installationRepositoriesMaxPages = 20

async function requestGitHub(
  request: typeof globalThis.fetch,
  url: string,
  accessToken: string,
): Promise<Response> {
  try {
    return await request(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: ["Bearer", accessToken].join(" "),
        "x-github-api-version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(providerRequestTimeoutMs),
    })
  } catch (error) {
    throw new GitHubProviderRequestError({ cause: error })
  }
}

/**
 * Lists the App installation's repositories this user can read. GitHub answers
 * 404 when the user cannot see the installation, which means no access.
 */
async function listReadableInstallationRepositories(
  request: typeof globalThis.fetch,
  installationId: number,
  accessToken: string,
): Promise<RepositoryAccessEvidence[]> {
  const repositories: RepositoryAccessEvidence[] = []
  let totalCount: number | undefined
  for (let page = 1; page <= installationRepositoriesMaxPages; page += 1) {
    const url = new URL(`https://api.github.com/user/installations/${installationId}/repositories`)
    url.search = new URLSearchParams({
      page: String(page),
      per_page: String(installationRepositoriesPageSize),
    }).toString()
    const response = await requestGitHub(request, url.toString(), accessToken)
    if (response.status === 404 && page === 1) return []
    if (!response.ok) throw new GitHubProviderRequestError()
    const body = installationRepositoriesResponseSchema.parse(await response.json())
    if (totalCount !== undefined && totalCount !== body.total_count) {
      throw new GitHubProviderRequestError()
    }
    totalCount = body.total_count
    repositories.push(
      ...body.repositories.map((repository) => ({
        defaultBranch: repository.default_branch,
        githubRepositoryId: repository.id,
        nameWithOwner: repository.full_name,
      })),
    )
    if (repositories.length === totalCount) {
      if (
        new Set(repositories.map((repository) => repository.githubRepositoryId)).size !== totalCount
      ) {
        throw new GitHubProviderRequestError()
      }
      return repositories
    }
    if (
      repositories.length > totalCount ||
      body.repositories.length < installationRepositoriesPageSize
    ) {
      throw new GitHubProviderRequestError()
    }
  }
  throw new GitHubProviderRequestError()
}

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

      const userResponse = await requestGitHub(
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
