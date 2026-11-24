import type { SecurityAuditPageData } from "@pages/security-audit-page/types"
import type { CurrentHubSession } from "@application/hub/administrator-contracts/types"
import type { SecurityAuditResponse } from "@application/hub/security-audit-contracts/types"
import type { HubAdministrationWorkspaceData } from "@features/hub-administration-workspace/types"

import { resourcePath } from "../resource-path"

const contextLabels: Record<string, string> = {
  appId: "GitHub App",
  billedOrganization: "Billed organization",
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

type RepositoryScope = { id: string; nameWithOwner?: string }

export function securityAuditPageData(
  session: CurrentHubSession,
  response: SecurityAuditResponse,
  navigation: HubAdministrationWorkspaceData,
  {
    repository,
    availableRepository = repository,
  }: {
    repository?: RepositoryScope
    availableRepository?: RepositoryScope
  } = {},
): SecurityAuditPageData {
  const hub = {
    id: "hub",
    label: "Hub",
    path: resourcePath("/settings/audit?scope=hub", {
      repositoryId: navigation.repository?.selectedRepositoryId ?? null,
    }),
  }
  const repositoryScope = availableRepository
    ? {
        id: availableRepository.id,
        label: availableRepository.nameWithOwner ?? "Repository",
        path: resourcePath("/settings/audit?scope=repository", {
          repositoryId: availableRepository.id,
        }),
      }
    : undefined
  const scope = repository && repositoryScope ? repositoryScope : hub
  return {
    administrationWorkspace: navigation,
    pageTitle: "Security audit",
    heading: "Security audit",
    description: repository
      ? `Security actions for ${repository.nameWithOwner ?? "this repository"}.`
      : "Hub-wide identity, sign-in, session, and administrator security actions.",
    notice: null,
    scopeLabel: "Audit scope",
    selectedScopeId: scope.id,
    scopes: repositoryScope && session.role === "ADMINISTRATOR" ? [repositoryScope, hub] : [scope],
    retention: "Records are shown newest first. Export and retention controls are not available.",
    emptyLabel: repository
      ? "No repository security actions are available."
      : "No Hub security actions are available.",
    nextLabel: "Older actions",
    nextPath: response.nextCursor
      ? resourcePath(scope.path, { before: response.nextCursor })
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
