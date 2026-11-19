import { z } from "zod"

import { GitHubProviderRequestError } from "../errors.ts"
import { requestGitHubUser } from "../request-github-user/index.ts"
import type { GitHubRepositoryAccessEvidence, GitHubRepositoryAccessLevel } from "../types.ts"

const repositoriesSchema = z.looseObject({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(
    z.looseObject({
      default_branch: z.string().min(1).max(255),
      full_name: z.string().min(3).max(255),
      id: z.number().int().positive(),
      permissions: z.looseObject({
        admin: z.boolean(),
        maintain: z.boolean().optional(),
        pull: z.boolean(),
        push: z.boolean(),
        triage: z.boolean().optional(),
      }),
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
): Promise<GitHubRepositoryAccessEvidence[]> {
  const repositories: GitHubRepositoryAccessEvidence[] = []
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
    const body = repositoriesSchema.safeParse(await response.json().catch(() => undefined))
    if (!body.success) throw new GitHubProviderRequestError({ cause: body.error })
    if (totalCount !== undefined && totalCount !== body.data.total_count) {
      throw new GitHubProviderRequestError()
    }
    totalCount = body.data.total_count
    repositories.push(
      ...body.data.repositories.map((repository) => ({
        accessLevel: accessLevel(repository.permissions),
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
    if (repositories.length > totalCount || body.data.repositories.length < pageSize) {
      throw new GitHubProviderRequestError()
    }
  }
  throw new GitHubProviderRequestError()
}

function accessLevel(
  permissions: z.infer<typeof repositoriesSchema>["repositories"][number]["permissions"],
): GitHubRepositoryAccessLevel {
  if (permissions.admin) return "ADMIN"
  if (permissions.maintain) return "MAINTAIN"
  if (permissions.push) return "WRITE"
  if (permissions.triage) return "TRIAGE"
  if (permissions.pull) return "READ"
  throw new GitHubProviderRequestError()
}
