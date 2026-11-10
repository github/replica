import type { SecurityAuditPageData } from "@pages/security-audit-page/types"
import type { CurrentHubSession } from "@application/hub/administrator-contracts/types"
import type { SecurityAuditResponse } from "@application/hub/security-audit-contracts/types"

import { administratorWorkspace } from "../administrator-workspace"

const contextLabels: Record<string, string> = {
  membershipId: "Membership",
  operation: "Operation",
  phase: "Phase",
  provider: "Provider",
  providerKeys: "Providers",
  reason: "Reason",
  revision: "Revision",
  role: "Role",
  source: "Source",
  targetCount: "Target count",
  targetId: "Target",
  targetMembershipId: "Target membership",
}

function contextLabel(key: string) {
  return (
    contextLabels[key] ??
    key
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/^./, (character) => character.toUpperCase())
  )
}

function contextValue(value: string | number | string[]) {
  return Array.isArray(value) ? value.join(", ") : String(value)
}

export function securityAuditPageData(
  session: CurrentHubSession,
  response: SecurityAuditResponse,
): SecurityAuditPageData {
  return {
    administrationWorkspace: {
      ...administratorWorkspace(session),
      selectedSection: "audit",
    },
    pageTitle: "Security audit",
    heading: "Security audit",
    description: "Hub-wide identity, sign-in, session, and administrator security actions.",
    notice: null,
    scopeLabel: "Audit scope",
    selectedScopeId: "hub",
    scopes: [{ id: "hub", label: "Hub", path: "/settings/audit?scope=hub" }],
    retention: "Records are shown newest first. Export and retention controls are not available.",
    emptyLabel: "No Hub security actions are available.",
    nextLabel: "Older actions",
    nextPath: response.nextCursor
      ? `/settings/audit?scope=hub&before=${encodeURIComponent(response.nextCursor)}`
      : null,
    repositoriesLabel: "Home",
    repositoriesPath: "/",
    signOutLabel: "Sign out",
    signOutPath: "/api/auth/session/sign-out",
    authenticityToken: "",
    columns: {
      time: "Time (UTC)",
      action: "Action",
      actor: "Actor",
      context: "Context",
      outcome: "Outcome",
    },
    events: response.records.map((record) => ({
      id: record.id,
      time: record.occurredAt,
      action: record.action,
      actor: record.actor ? `Membership ${record.actor.membershipId}` : "Not available",
      context: Object.entries(record.context).map(([key, value]) => ({
        label: contextLabel(key),
        value: contextValue(value),
      })),
      outcome:
        record.outcome === "success"
          ? "Succeeded"
          : record.outcome === "denied"
            ? "Denied"
            : record.outcome === "failure"
              ? "Failed"
              : "Not recorded",
    })),
  }
}
