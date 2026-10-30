import type { SecurityAuditPageData } from "@pages/security-audit-page/types"

import type { WorkspaceResponse } from "../../contracts"
import type { SettingsQuery, SettingsWorkspaceResponse } from "../../settings-contracts"
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
    pageTitle: "Mock security audit",
    heading: "Security audit",
    description:
      "Inspect local mock settings transitions. No external log, network address or real security event is collected.",
    notice: null,
    scopeLabel: "Mock audit scope",
    selectedScopeId: hubScope ? "hub" : String(state.repository?.id ?? "none"),
    scopes: [
      ...(state.session.capabilities.administerHub
        ? [
            {
              id: "hub",
              label: "Hub fixture",
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
      ? "This mock profile cannot read the selected audit fixture. No authorized records were returned."
      : null,
    retention:
      "Records exist only in this browser's in-memory mock store. A reset or full reload discards them.",
    emptyLabel: state.audit.accessDenied
      ? "Mock audit access denied."
      : "No mock settings changes in this scope.",
    nextLabel: "Older mock changes",
    nextPath: state.audit.nextPage
      ? resourcePath("/settings/audit", search, {
          scope: state.audit.scope,
          repositoryId: query.repositoryId ?? null,
          page: state.audit.nextPage,
        })
      : null,
    repositoriesLabel: "Repositories",
    repositoriesPath: "/",
    signOutLabel: "Sign out of mock session",
    signOutPath: "/session",
    authenticityToken: "",
    columns: {
      time: "Time",
      action: "Mock action",
      actor: "Synthetic user",
      ip: "Source IP",
      context: "Mock outcome",
      outcome: "Result",
    },
    events: state.audit.events.map((event) => ({
      id: event.id,
      time: event.createdAt,
      action: event.operation,
      actor: event.actor,
      ip: "Not collected",
      context: event.context,
      outcome: "Local fixture changed",
    })),
  }
}
