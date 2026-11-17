import type { RepositoryScope } from "../../../../repositories/prototype-index/visible-repository-where/index.ts"

/**
 * Once GitHub repository scoping is active, only ID-backed repositories are visible.
 * GitHub members see only repositories they could read at sign-in. Administrators
 * and other providers see all identified repositories. An unknown session provider
 * is scoped rather than treated as non-GitHub.
 */
export function resolveRepositoryScope(
  viewer: {
    membershipId: string
    sessionProvider: string | null
    role: "MEMBER" | "ADMINISTRATOR"
  },
  scopeGitHubMembers: boolean,
): RepositoryScope {
  if (!scopeGitHubMembers) return null
  if (
    viewer.role === "ADMINISTRATOR" ||
    (typeof viewer.sessionProvider === "string" && viewer.sessionProvider !== "github")
  ) {
    return {}
  }
  return { membershipId: viewer.membershipId }
}
