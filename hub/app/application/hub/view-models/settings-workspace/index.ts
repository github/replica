import type { HubWorkspaceData } from "@features/hub-workspace/types"

import type { WorkspaceResponse } from "../../contracts"
import type { SettingsWorkspaceResponse } from "../../settings-contracts"
import { repositoryWorkspace } from "../repository-workspace"
import { resourcePath } from "../resource-path"

export function settingsWorkspace(
  workspace: WorkspaceResponse,
  state: SettingsWorkspaceResponse,
  search: URLSearchParams,
  selectedSection: HubWorkspaceData["selectedSection"],
): HubWorkspaceData {
  const repository = state.repository
    ? repositoryWorkspace(workspace, state.repository, search)
    : null
  const repositoryId = state.repository?.id
  const admin = state.session.capabilities.administerHub
  function path(pathname: string) {
    return resourcePath(pathname, search)
  }
  return {
    accountMenuLabel: `Account menu for @${workspace.viewer.login}`,
    authenticityToken: "",
    collapseNavigationLabel: "Collapse sidebar",
    currentUser: workspace.viewer,
    darkThemeLabel: "Dark",
    expandNavigationLabel: "Expand sidebar",
    feedbackLabel: "Feedback",
    lightThemeLabel: "Light",
    productName: "Replica Hub",
    navigationLabel: "Hub navigation",
    settingsNavigationLabel: "Mock Hub settings",
    selectedSection,
    repositoriesLabel: "Repositories",
    repositoriesPath: "/",
    signOutLabel: "Sign out of mock session",
    signOutPath: "/session",
    systemThemeLabel: "System",
    welcomeLabel: "Welcome",
    welcomePath: state.welcomeHidden ? null : path("/welcome"),
    notificationsLabel: "Inbox",
    notificationsPath: path("/notifications"),
    notificationsUnread: state.notifications.unreadCount > 0,
    notificationsUnreadCount: state.notifications.unreadCount,
    notificationsUnreadLabel: `Inbox, ${state.notifications.unreadCount} unread`,
    repository:
      repository && repositoryId
        ? {
            ...repository,
            newPrototypePath: state.session.capabilities.createPrototypes
              ? path(`/repositories/${repositoryId}/new`)
              : null,
            analyticsLabel: "Analytics",
            analyticsPath: resourcePath("/settings/analytics", search, { repositoryId }),
            learningsLabel: "Learnings",
            learningsPath: resourcePath("/settings/learnings", search, { repositoryId }),
          }
        : null,
    administrationLinks: admin
      ? [
          { section: "admins", label: "Hub administrators", path: path("/settings/admins") },
          { section: "sharing", label: "Public sharing", path: path("/admin/sharing") },
          { section: "sessions", label: "Mock browser session", path: path("/settings/sessions") },
          { section: "github", label: "GitHub App", path: path("/settings/github") },
          { section: "copilot", label: "Copilot", path: path("/settings/copilot") },
        ]
      : [],
    securityAuditLabel: "Security audit",
    securityAuditPath: resourcePath("/settings/audit", search, {
      repositoryId: repositoryId ?? null,
      scope: admin ? "hub" : "repository",
    }),
  }
}
