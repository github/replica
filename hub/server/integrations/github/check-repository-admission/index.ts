import type { GitHubUserProfile } from "#server/integrations/github/create-user-auth-client/types"
import { createInstallationToken } from "#server/integrations/github/create-installation-token"
import {
  collaboratorPermissionSchema,
  installedRepositoriesSchema,
  repositoryAdmissionBatchSize,
  repositoryAdmissionLimit,
  repositoryAdmissionTimeoutMs,
} from "#server/integrations/github/check-repository-admission/constants"
import { GitHubApiError } from "#server/integrations/github/github-api-error"
import { requestGitHubApi } from "#server/integrations/github/request-github-api"
import type { GitHubCredentials } from "#server/integrations/github/validate-github-credentials/types"
import { AuthenticationError } from "#server/utils/authentication-error"

async function hasPermission(
  token: string,
  profile: GitHubUserProfile,
  repository: string,
  signal: AbortSignal,
): Promise<boolean> {
  let response: unknown
  try {
    response = await requestGitHubApi(
      `/repos/${repository}/collaborators/${encodeURIComponent(profile.username)}/permission`,
      token,
      "GET",
      signal,
    )
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return false
    throw error
  }
  const permission = collaboratorPermissionSchema.parse(response)
  if (String(permission.user.id) !== profile.subject) {
    throw new AuthenticationError(
      403,
      "identity_mismatch",
      "The repository permission identity did not match.",
    )
  }
  return permission.permission !== "none"
}

export async function checkRepositoryAdmission(
  credentials: GitHubCredentials,
  profile: GitHubUserProfile,
): Promise<boolean> {
  const token = await createInstallationToken(credentials)
  const signal = AbortSignal.timeout(repositoryAdmissionTimeoutMs)
  const response = installedRepositoriesSchema.parse(
    await requestGitHubApi(
      `/installation/repositories?per_page=${repositoryAdmissionLimit}&page=1`,
      token,
      "GET",
      signal,
    ),
  )
  const repositories = response.repositories.filter((repository) => repository.private)
  for (let offset = 0; offset < repositories.length; offset += repositoryAdmissionBatchSize) {
    const batch = repositories.slice(offset, offset + repositoryAdmissionBatchSize)
    if (
      (
        await Promise.all(
          batch.map((repository) => hasPermission(token, profile, repository.full_name, signal)),
        )
      ).some(Boolean)
    ) {
      return true
    }
  }
  if (response.repositories.length < repositoryAdmissionLimit) return false
  throw new AuthenticationError(
    503,
    "repository_limit",
    "Repository admission exceeded the supported repository limit.",
  )
}
