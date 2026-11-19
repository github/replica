import type { HubWorkspaceData } from "@features/hub-workspace/types"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import { notificationInboxConfiguration } from "@utils/notification/inbox-configuration"

import { resourcePath } from "../resource-path"

export function workspaceNavigation(
  workspace: WorkspaceResponse,
  repositoryId: string | null,
  search: URLSearchParams,
  real = false,
): Omit<HubWorkspaceData, "repository"> {
  const admin = workspace.capabilities?.administerHub
  const repositoryAdmin = workspace.repositories.find(({ id }) => id === repositoryId)?.capabilities
    ?.administerRepository
  const unreadCount = workspace.navigation?.notificationsUnreadCount ?? 0
  const inboxConnected = real && workspace.reviewInboxAvailable
  const welcomeVisible = real
    ? workspace.welcomeHidden === false
    : !workspace.navigation?.welcomeHidden
  return {
    accountMenuLabel: `Account menu for ${
      workspace.viewer.provider && workspace.viewer.provider !== "github"
        ? (workspace.viewer.name ?? workspace.viewer.login)
        : `@${workspace.viewer.login}`
    }`,
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
    canvasConnectionsPath: real ? "/canvas/connections" : undefined,
    repositoriesLabel: "Repositories",
    repositoriesPath: "/repositories",
    signOutLabel: "Sign out",
    signOutPath: real ? "/api/auth/session/sign-out" : "/session",
    systemThemeLabel: "System",
    welcomeLabel: "Welcome",
    welcomePath: welcomeVisible ? resourcePath("/welcome", search, { repositoryId }) : null,
    notificationsLabel: real ? "Inbox" : "Notifications",
    notificationsPath:
      !real || inboxConnected
        ? resourcePath("/notifications", search, { repositoryId })
        : undefined,
    notificationInbox: inboxConnected
      ? { ...notificationInboxConfiguration, connected: true }
      : undefined,
    notificationsUnread: unreadCount > 0,
    notificationsUnreadCount: unreadCount,
    notificationsUnreadLabel: `${real ? "Inbox" : "Notifications"}, ${unreadCount} unread`,
    administrationLinks: admin
      ? real
        ? [
            { section: "admins", label: "Hub administrators", path: "/settings/administrators" },
            ...(workspace.publicSharingSettingsAvailable
              ? [
                  {
                    section: "sharing" as const,
                    label: "Public sharing",
                    path: "/settings/sharing",
                  },
                ]
              : []),
            { section: "sessions", label: "End all Hub sessions", path: "/settings/sessions" },
            { section: "copilot", label: "Copilot connection", path: "/settings/copilot" },
          ]
        : [
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
    securityAuditPath: real
      ? repositoryAdmin && repositoryId
        ? `/settings/audit?scope=repository&repositoryId=${encodeURIComponent(repositoryId)}`
        : admin
          ? "/settings/audit?scope=hub"
          : null
      : admin || repositoryId !== null
        ? resourcePath("/settings/audit", search, {
            repositoryId,
            scope: admin ? "hub" : "repository",
          })
        : null,
  }
}
