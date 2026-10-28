import type {
  AccessDecision,
  AccessInput,
} from "#server/domains/prototype-authorization/evaluate-access/types"

export function evaluatePrototypeAccess({
  workspaceGrant,
  prototypeGrant,
  baseline = null,
}: AccessInput): AccessDecision {
  if (prototypeGrant?.effect === "deny" || workspaceGrant?.effect === "deny") {
    return {
      allowed: false,
      role: null,
      source: prototypeGrant?.effect === "deny" ? "hub-prototype" : "hub-workspace",
      reason: "explicit_deny",
    }
  }
  if (prototypeGrant?.effect === "allow" && prototypeGrant.role) {
    return {
      allowed: true,
      role: prototypeGrant.role,
      source: "hub-prototype",
      reason: "prototype_role",
    }
  }
  if (workspaceGrant?.effect === "allow" && workspaceGrant.role) {
    return {
      allowed: true,
      role: workspaceGrant.role,
      source: "hub-workspace",
      reason: "workspace_role",
    }
  }
  if (baseline) {
    return {
      allowed: true,
      role: baseline.role,
      source: "github-synchronized",
      reason: "github_baseline",
      baseline: {
        repositorySourceId: baseline.repositorySourceId,
        githubRepositoryId: baseline.githubRepositoryId,
        rawPermission: baseline.rawPermission,
        confirmedAt: baseline.confirmedAt,
        synchronizationStatus: baseline.synchronizationStatus,
      },
    }
  }
  return {
    allowed: false,
    role: null,
    source: "none",
    reason: "no_access",
  }
}
