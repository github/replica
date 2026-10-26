import type { GitHubCredentials, GitHubProfile } from "#server/utils/identity-contracts/types"
import { createAppToken } from "#server/integrations/github/create-app-token"
import { createInstallationToken } from "#server/integrations/github/create-installation-token"
import { getCollaboratorPermission } from "#server/integrations/github/get-collaborator-permission"
import { requestGitHub } from "#server/integrations/github/request-github"
import { IdentityError } from "#server/utils/identity-error"

import { installationsSchema, repositoriesSchema } from "./constants.ts"

export async function isUserAdmitted(
  credentials: GitHubCredentials,
  profile: GitHubProfile,
): Promise<boolean> {
  for (let page = 1; page <= 100; page++) {
    const installations = installationsSchema.parse(
      await requestGitHub(
        `/app/installations?per_page=100&page=${page}`,
        createAppToken(credentials),
      ),
    )
    for (const installation of installations) {
      const token = await createInstallationToken(credentials, installation.id)
      for (let repositoryPage = 1; repositoryPage <= 100; repositoryPage++) {
        const data = repositoriesSchema.parse(
          await requestGitHub(
            `/installation/repositories?per_page=100&page=${repositoryPage}`,
            token,
          ),
        )
        for (const repository of data.repositories) {
          if ((await getCollaboratorPermission(token, profile, repository.full_name)) !== "none") {
            return true
          }
        }
        if (data.repositories.length < 100) break
        if (repositoryPage === 100) {
          throw new IdentityError(
            503,
            "github_limit",
            "GitHub repository discovery exceeded the supported page limit.",
          )
        }
      }
    }
    if (installations.length < 100) return false
  }
  throw new IdentityError(
    503,
    "github_limit",
    "GitHub installation discovery exceeded the supported page limit.",
  )
}
