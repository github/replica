import type { HubWorkspaceData } from "@features/hub-workspace/types"

import type { WorkspaceResponse } from "../../contracts/types"
import { resourcePath } from "../resource-path"

export function workspaceNavigation(
  workspace: WorkspaceResponse,
  repositoryId: number | null,
  search: URLSearchParams,
): Omit<HubWorkspaceData, "repository"> {
  const admin = workspace.capabilities?.administerHub
  const unreadCount = workspace.navigation?.notificationsUnreadCount ?? 0
  function path(pathname: string) {
    return resourcePath(pathname, search, { repositoryId })
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
    navigationLabel: repositoryId === null ? "Hub navigation" : "Repository navigation",
    settingsNavigationLabel: "Security and settings",
    repositoriesLabel: "Repositories",
    repositoriesPath: "/repositories",
    signOutLabel: "Sign out",
    signOutPath: "/session",
    systemThemeLabel: "System",
    welcomeLabel: "Welcome",
    welcomePath: workspace.navigation?.welcomeHidden ? null : path("/welcome"),
    notificationsLabel: "Notifications",
    notificationsPath: path("/notifications"),
    notificationsUnread: unreadCount > 0,
    notificationsUnreadCount: unreadCount,
    notificationsUnreadLabel: `Notifications, ${unreadCount} unread`,
    administrationLinks: admin
      ? [
          { section: "admins", label: "Hub administrators", path: path("/settings/admins") },
          { section: "sharing", label: "Public sharing", path: path("/settings/sharing") },
          { section: "sessions", label: "End all Hub sessions", path: path("/settings/sessions") },
          { section: "github", label: "GitHub App", path: path("/settings/github") },
          { section: "copilot", label: "Copilot connection", path: path("/settings/copilot") },
        ]
      : [],
    securityAuditLabel: "Security audit",
    securityAuditPath:
      admin || repositoryId !== null
        ? resourcePath("/settings/audit", search, {
            repositoryId,
            scope: admin ? "hub" : "repository",
          })
        : null,
  }
}
