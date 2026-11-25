import type { HubWorkspaceData } from "@features/hub-workspace/types"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import { notificationInboxConfiguration } from "@utils/notification/inbox-configuration"

import { resourcePath } from "../resource-path"

export function workspaceNavigation(
  workspace: WorkspaceResponse,
  repositoryId: string | null,
): Omit<HubWorkspaceData, "repository"> {
  const admin = workspace.capabilities?.administerHub
  const repositoryAdmin = workspace.repositories.find(({ id }) => id === repositoryId)?.capabilities
    ?.administerRepository
  const inboxConnected = workspace.reviewInboxAvailable
  const welcomeVisible = workspace.welcomeHidden === false
  const context = { repositoryId }
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
    canvasConnectionsPath: resourcePath("/canvas/connections", context),
    emptyRepositoryLabel: repositoryId === null ? "No repository selected" : undefined,
    repositoriesLabel: "Prototypes",
    repositoriesPath: "/repositories",
    signOutLabel: "Sign out",
    signOutPath: "/api/auth/session/sign-out",
    systemThemeLabel: "System",
    welcomeLabel: "Welcome",
    welcomePath: welcomeVisible ? resourcePath("/welcome", context) : null,
    notificationsLabel: "Inbox",
    notificationsPath: inboxConnected ? resourcePath("/notifications", context) : undefined,
    notificationInbox: inboxConnected
      ? { ...notificationInboxConfiguration, connected: true }
      : undefined,
    notificationsUnread: workspace.inboxHasUnread,
    inboxViewerId: workspace.viewer.id,
    administrationLinks: admin
      ? [
          {
            section: "admins",
            label: "Hub administrators",
            path: resourcePath("/settings/administrators", context),
          },
          ...(workspace.publicSharingSettingsAvailable
            ? [
                {
                  section: "sharing" as const,
                  label: "Public sharing",
                  path: resourcePath("/settings/sharing", context),
                },
              ]
            : []),
          {
            section: "sessions",
            label: "End all Hub sessions",
            path: resourcePath("/settings/sessions", context),
          },
          {
            section: "copilot",
            label: "Copilot connection",
            path: resourcePath("/settings/copilot", context),
          },
        ]
      : [],
    securityAuditLabel: "Security audit",
    securityAuditPath: admin
      ? resourcePath("/settings/audit?scope=hub", context)
      : repositoryAdmin && repositoryId
        ? resourcePath("/settings/audit?scope=repository", context)
        : null,
  }
}
