import { z } from "zod"

import { GitHubProviderRequestError } from "../errors.ts"
import { requestGitHubUser } from "../request-github-user/index.ts"
import type { GitHubRepositoryEvidence } from "../types.ts"

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
 * Lists the App installation's repositories this user can read. GitHub answers
 * 404 when the user cannot see the installation, which means no access.
 */
export async function listReadableInstallationRepositories(
  request: typeof globalThis.fetch,
  installationId: number,
  accessToken: string,
): Promise<GitHubRepositoryEvidence[]> {
  const repositories: GitHubRepositoryEvidence[] = []
  let totalCount: number | undefined
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(`https://api.github.com/user/installations/${installationId}/repositories`)
    url.search = new URLSearchParams({
      page: String(page),
      per_page: String(pageSize),
    }).toString()
    const response = await requestGitHubUser(request, url.toString(), accessToken)
    if (response.status === 404 && page === 1) return []
    if (!response.ok) throw new GitHubProviderRequestError()
    const body = repositoriesSchema.parse(await response.json())
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
