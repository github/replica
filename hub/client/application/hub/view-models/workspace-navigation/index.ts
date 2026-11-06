import type { HubWorkspaceData } from "@features/hub-workspace/types"
import type { WorkspaceResponse } from "@application/hub/contracts/types"

import { resourcePath } from "../resource-path"

export function workspaceNavigation(
  workspace: WorkspaceResponse,
  repositoryId: number | null,
  search: URLSearchParams,
): Omit<HubWorkspaceData, "repository"> {
  const admin = workspace.capabilities?.administerHub
  const unreadCount = workspace.navigation?.notificationsUnreadCount ?? 0
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
    welcomePath: workspace.navigation?.welcomeHidden
      ? null
      : resourcePath("/welcome", search, { repositoryId }),
    notificationsLabel: "Notifications",
    notificationsPath: resourcePath("/notifications", search, { repositoryId }),
    notificationsUnread: unreadCount > 0,
    notificationsUnreadCount: unreadCount,
    notificationsUnreadLabel: `Notifications, ${unreadCount} unread`,
    administrationLinks: admin
      ? [
          {
            section: "admins",
            label: "Hub administrators",
            path: resourcePath("/settings/admins", search, { repositoryId }),
          },
          {
            section: "sharing",
            label: "Public sharing",
            path: resourcePath("/settings/sharing", search, { repositoryId }),
          },
          {
            section: "sessions",
            label: "End all Hub sessions",
            path: resourcePath("/settings/sessions", search, { repositoryId }),
          },
          {
            section: "github",
            label: "GitHub App",
            path: resourcePath("/settings/github", search, { repositoryId }),
          },
          {
            section: "copilot",
            label: "Copilot connection",
            path: resourcePath("/settings/copilot", search, { repositoryId }),
          },
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
