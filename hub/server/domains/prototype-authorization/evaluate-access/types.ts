export type PrototypeRole = "viewer" | "commenter" | "editor" | "administrator"

export interface AccessGrant {
  effect: "allow" | "deny"
  role: PrototypeRole | null
}

export interface AccessDecision {
  allowed: boolean
  role: PrototypeRole | null
  source: "hub-prototype" | "hub-workspace" | "github-synchronized" | "none"
  reason: "explicit_deny" | "prototype_role" | "workspace_role" | "github_baseline" | "no_access"
  baseline?: {
    repositorySourceId: string
    githubRepositoryId: string
    rawPermission: string
    confirmedAt: Date
    synchronizationStatus: string
  }
}

export interface AccessInput {
  workspaceGrant?: AccessGrant | null
  prototypeGrant?: AccessGrant | null
  baseline?: {
    role: PrototypeRole
    repositorySourceId: string
    githubRepositoryId: string
    rawPermission: string
    confirmedAt: Date
    synchronizationStatus: string
  } | null
}
