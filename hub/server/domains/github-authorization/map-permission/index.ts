import type { PrototypeRole } from "#server/domains/prototype-authorization/evaluate-access/types"

export type GitHubRepositoryPermission = "admin" | "maintain" | "write" | "triage" | "read" | "none"

export interface MappedGitHubPermission {
  admissionEligible: boolean
  prototypeRole: PrototypeRole | null
}

export function mapGitHubPermission(
  permission: GitHubRepositoryPermission,
): MappedGitHubPermission {
  switch (permission) {
    case "admin":
    case "maintain":
    case "write":
      return { admissionEligible: true, prototypeRole: "editor" }
    case "triage":
      return { admissionEligible: true, prototypeRole: "commenter" }
    case "read":
      return { admissionEligible: true, prototypeRole: "viewer" }
    case "none":
      return { admissionEligible: false, prototypeRole: null }
  }
}
