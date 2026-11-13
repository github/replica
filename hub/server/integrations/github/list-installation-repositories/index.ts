import type { KeyObject } from "node:crypto"
import { z } from "zod"

import type { ConnectedRepositoryEvidence } from "../../../repositories/repository-access/types.ts"
import { createGitHubAppJwt } from "../create-github-app-jwt/index.ts"
import { GitHubProviderRequestError } from "../errors.ts"

const tokenSchema = z.looseObject({ token: z.string().min(1) })
const repositoriesSchema = z.looseObject({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(
    z.looseObject({
      default_branch: z.string().min(1).max(255),
      full_name: z.string().min(3).max(255),
      id: z.number().int().positive(),
    }),
  ),
})
const pageSize = 100
const maxPages = 20

/**
 * Lists every repository the App installation can read. Throws instead of
 * returning a partial list, so callers never disconnect repositories by mistake.
 */
export async function listInstallationRepositories(
  input: { appId: string; installationId: string; privateKey: KeyObject },
  {
    apiUrl = "https://api.github.com",
    fetch: request = fetch,
    now = () => new Date(),
    timeoutMs = 10_000,
  }: { apiUrl?: string; fetch?: typeof fetch; now?: () => Date; timeoutMs?: number } = {},
): Promise<ConnectedRepositoryEvidence[]> {
  async function send(path: string, token: string, method = "GET") {
    let response: Response
    try {
      response = await request(new URL(path, apiUrl), {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "Replica-Hub",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        method,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw new GitHubProviderRequestError({ cause: error })
    }
    if (!response.ok) throw new GitHubProviderRequestError()
    return (await response.json()) as unknown
  }

  const { token } = tokenSchema.parse(
    await send(
      `/app/installations/${encodeURIComponent(input.installationId)}/access_tokens`,
      createGitHubAppJwt(input, now()),
      "POST",
    ),
  )
  const repositories: ConnectedRepositoryEvidence[] = []
  let totalCount: number | undefined
  for (let page = 1; page <= maxPages; page += 1) {
    const body = repositoriesSchema.parse(
      await send(`/installation/repositories?per_page=${pageSize}&page=${page}`, token),
    )
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
    if (repositories.length > totalCount || body.repositories.length < pageSize) {
      throw new GitHubProviderRequestError()
    }
  }
  throw new GitHubProviderRequestError()
}
