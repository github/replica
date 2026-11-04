import type { HubWorkspaceData } from "@features/hub-workspace/types"

import type { WorkspaceResponse } from "../../contracts"
import type { SettingsWorkspaceResponse } from "../../settings-contracts"
import { repositoryWorkspace } from "../repository-workspace"
import { resourcePath } from "../resource-path"

type NavigationState = Pick<SettingsWorkspaceResponse, "repository" | "welcomeHidden"> & {
  session: { capabilities: WorkspaceResponse["capabilities"] }
  notifications: Pick<SettingsWorkspaceResponse["notifications"], "unreadCount">
}

export function settingsWorkspace(
  workspace: WorkspaceResponse,
  state: NavigationState,
  search: URLSearchParams,
  selectedSection: HubWorkspaceData["selectedSection"],
): HubWorkspaceData {
  const repository = state.repository
    ? repositoryWorkspace(
        { ...workspace, capabilities: state.session.capabilities },
        state.repository,
        search,
      )
    : null
  const repositoryId = state.repository?.id
  const admin = state.session.capabilities?.administerHub
  function path(pathname: string) {
    return resourcePath(pathname, search, { repositoryId: repositoryId ?? null })
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
    settingsNavigationLabel: "Security and settings",
    selectedSection,
    repositoriesLabel: "Repositories",
    repositoriesPath: "/repositories",
    signOutLabel: "Sign out",
    signOutPath: "/session",
    systemThemeLabel: "System",
    welcomeLabel: "Welcome",
    welcomePath: state.welcomeHidden ? null : path("/welcome"),
    notificationsLabel: "Notifications",
    notificationsPath: path("/notifications"),
    notificationsUnread: state.notifications.unreadCount > 0,
    notificationsUnreadCount: state.notifications.unreadCount,
    notificationsUnreadLabel: `Notifications, ${state.notifications.unreadCount} unread`,
    repository:
      repository && repositoryId
        ? {
            ...repository,
            newPrototypePath: state.session.capabilities?.createPrototypes
              ? resourcePath(`/repositories/${repositoryId}/new`, search)
              : null,
            analyticsLabel: "Analytics",
            analyticsPath: resourcePath(`/repositories/${repositoryId}/analytics`, search),
            learningsLabel: "Learnings",
            learningsPath: resourcePath(`/repositories/${repositoryId}/learnings`, search),
          }
        : null,
    administrationLinks: admin
      ? [
          { section: "admins", label: "Hub administrators", path: path("/settings/admins") },
          { section: "sharing", label: "Public sharing", path: path("/settings/sharing") },
          { section: "sessions", label: "End all Hub sessions", path: path("/settings/sessions") },
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
