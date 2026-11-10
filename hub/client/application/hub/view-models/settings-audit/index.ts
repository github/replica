import type { SecurityAuditPageData } from "@pages/security-audit-page/types"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import type {
  SettingsQuery,
  SettingsWorkspaceResponse,
} from "@application/hub/settings-contracts/types"

import { resourcePath } from "../resource-path"
import { settingsRepositoryWorkspace } from "../settings-repository-workspace"
import { settingsWorkspace } from "../settings-workspace"

export function settingsAudit(
  workspace: WorkspaceResponse,
  state: SettingsWorkspaceResponse,
  search: URLSearchParams,
  query: SettingsQuery,
): SecurityAuditPageData {
  const hubScope = state.audit.scope === "hub"
  const hub = settingsWorkspace(workspace, state, search, "audit")
  return {
    administrationWorkspace: hubScope ? { ...hub, selectedSection: "audit" } : null,
    workspace:
      !hubScope && state.repository
        ? settingsRepositoryWorkspace(workspace, state, search, "audit")
        : undefined,
    pageTitle: "Security audit",
    heading: "Security audit",
    description: hubScope
      ? "Deployment security actions. Repository records require that repository's GitHub admin permission."
      : `Security actions for ${state.repository?.nameWithOwner ?? "this repository"}. Global setup and operator records are not included.`,
    notice: null,
    scopeLabel: "Audit scope",
    selectedScopeId: hubScope ? "hub" : String(state.repository?.id ?? "none"),
    scopes: [
      ...(state.session.capabilities.administerHub
        ? [
            {
              id: "hub",
              label: "Hub",
              path: resourcePath("/settings/audit", search, { scope: "hub" }),
            },
          ]
        : []),
      ...workspace.repositories.map((repository) => ({
        id: String(repository.id),
        label: repository.nameWithOwner,
        path: resourcePath("/settings/audit", search, {
          scope: "repository",
          repositoryId: repository.id,
        }),
      })),
    ],
    scopesUnavailableMessage: state.audit.accessDenied
      ? "You do not have permission to view security records for this scope."
      : null,
    retention: "Records are kept for 90 days and are never sent to analytics destinations.",
    emptyLabel: state.audit.accessDenied
      ? "Security audit access denied."
      : "No retained security actions.",
    nextLabel: "Older actions",
    nextPath: state.audit.nextPage
      ? resourcePath("/settings/audit", search, {
          scope: state.audit.scope,
          repositoryId: query.repositoryId ?? null,
          page: state.audit.nextPage,
        })
      : null,
    repositoriesLabel: "Repositories",
    repositoriesPath: "/repositories",
    signOutLabel: "Sign out",
    signOutPath: "/session",
    authenticityToken: "",
    columns: {
      time: "Time (UTC)",
      action: "Action",
      actor: "Actor",
      context: "Context",
      outcome: "Outcome",
    },
    events: state.audit.events.map((event) => ({
      id: String(event.id),
      time: event.createdAt,
      action: event.operation,
      actor: event.actor,
      context: [{ label: "Fixture details", value: event.context }],
      outcome: "Succeeded",
    })),
  }
}
