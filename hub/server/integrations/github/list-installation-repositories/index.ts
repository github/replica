import { z } from "zod"

import {
  createGitHubInstallationClient,
  type GitHubInstallationClient,
} from "../create-installation-client/index.ts"
import type {
  GitHubInstallationCredentials,
  GitHubInstallationTransport,
} from "../create-installation-client/types.ts"
import { GitHubProviderRequestError } from "../errors.ts"
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
 * Lists every repository the App installation can read. Throws instead of
 * returning a partial list, so callers never disconnect repositories by mistake.
 */
export async function listInstallationRepositories(
  input: GitHubInstallationCredentials,
  transport?: GitHubInstallationTransport,
): Promise<GitHubRepositoryEvidence[]> {
  return readInstallationRepositories(await createGitHubInstallationClient(input, transport))
}

export async function readInstallationRepositories(
  client: GitHubInstallationClient,
): Promise<GitHubRepositoryEvidence[]> {
  const repositories: GitHubRepositoryEvidence[] = []
  let totalCount: number | undefined
  for (let page = 1; page <= maxPages; page += 1) {
    const body = await client.get(
      `/installation/repositories?per_page=${pageSize}&page=${page}`,
      repositoriesSchema,
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
