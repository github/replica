import type { RepositoryScope } from "../../../../repositories/prototype-index/visible-repository-where/index.ts"

/**
 * GitHub members see only repositories they could read at sign-in once Hub is
 * connected to an App installation. Administrators and other providers see all.
 */
export function resolveRepositoryScope(
  viewer: { membershipId: string; provider: string; role: "MEMBER" | "ADMINISTRATOR" },
  scopeGitHubMembers: boolean,
): RepositoryScope {
  if (!scopeGitHubMembers || viewer.role === "ADMINISTRATOR" || viewer.provider !== "github") {
    return null
  }
  return { membershipId: viewer.membershipId }
}
