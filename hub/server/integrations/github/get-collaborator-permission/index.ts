import type { GitHubProfile, RepositoryPermission } from "#server/utils/identity-contracts/types"
import { GitHubResponseError } from "#server/integrations/github/github-response-error"
import { requestGitHub } from "#server/integrations/github/request-github"
import { IdentityError } from "#server/utils/identity-error"

import { collaboratorPermissionSchema } from "./constants.ts"

export async function getCollaboratorPermission(
  token: string,
  profile: GitHubProfile,
  fullName: string,
): Promise<RepositoryPermission> {
  let data: unknown
  try {
    data = await requestGitHub(
      `/repos/${fullName}/collaborators/${encodeURIComponent(profile.login)}/permission`,
      token,
    )
  } catch (error) {
    if (error instanceof GitHubResponseError && error.upstreamStatus === 404) return "none"
    throw error
  }
  const result = collaboratorPermissionSchema.parse(data)
  if (String(result.user.id) !== profile.providerId) {
    throw new IdentityError(
      403,
      "identity_mismatch",
      "GitHub's repository permission response did not match the signed-in account.",
    )
  }
  if (result.permission === "maintain") return "write"
  if (result.permission === "triage") return "read"
  return result.permission
}
