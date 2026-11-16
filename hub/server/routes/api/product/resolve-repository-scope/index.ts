import type { RepositoryScope } from "../../../../repositories/prototype-index/visible-repository-where/index.ts"

/**
 * GitHub members see only repositories they could read at sign-in once Hub is
 * connected to an App installation. Administrators and other providers see all.
 * An unknown session provider is scoped rather than treated as non-GitHub.
 */
export function resolveRepositoryScope(
  viewer: {
    membershipId: string
    sessionProvider: string | null
    role: "MEMBER" | "ADMINISTRATOR"
  },
  scopeGitHubMembers: boolean,
): RepositoryScope {
  if (
    !scopeGitHubMembers ||
    viewer.role === "ADMINISTRATOR" ||
    (typeof viewer.sessionProvider === "string" && viewer.sessionProvider !== "github")
  ) {
    return null
  }
  return { membershipId: viewer.membershipId }
}
