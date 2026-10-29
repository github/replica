export type PrototypeRole = "viewer" | "commenter" | "editor" | "administrator"

export interface AccessGrant {
  effect: "allow" | "deny"
  role: PrototypeRole | null
}

export interface AccessDecision {
  allowed: boolean
  role: PrototypeRole | null
  source: "hub-prototype" | "hub-workspace" | "baseline" | "none"
  reason: "explicit_deny" | "prototype_role" | "workspace_role" | "baseline_role" | "no_access"
}

export interface AccessInput {
  workspaceGrant?: AccessGrant | null
  prototypeGrant?: AccessGrant | null
  baselineRole?: PrototypeRole | null
}
