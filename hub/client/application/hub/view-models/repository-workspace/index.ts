import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"

import type { RepositoryRecord, WorkspaceResponse } from "../../contracts"
import { resourcePath } from "../resource-path"

export function repositoryWorkspace(
  workspace: WorkspaceResponse,
  repository: RepositoryRecord,
  search: URLSearchParams,
): RepositoryWorkspaceData {
  function hubPath(pathname: string) {
    return resourcePath(pathname, search, { repositoryId: repository.id })
  }

  return {
    accountMenuLabel: `Account menu for @${workspace.viewer.login}`,
    authenticityToken: "",
    analyticsLabel: "Analytics",
    analyticsPath: resourcePath("/settings/analytics", search, { repositoryId: repository.id }),
    learningsLabel: "Learnings",
    learningsPath: resourcePath("/settings/learnings", search, { repositoryId: repository.id }),
    collapseNavigationLabel: "Collapse sidebar",
    currentUser: workspace.viewer,
    darkThemeLabel: "Dark",
    expandNavigationLabel: "Expand sidebar",
    feedbackLabel: "Feedback",
    lightThemeLabel: "Light",
    navigationLabel: "Repository navigation",
    notificationsLabel: "Notifications",
    notificationsPath: hubPath("/notifications"),
    notificationsUnread: (workspace.navigation?.notificationsUnreadCount ?? 0) > 0,
    notificationsUnreadCount: workspace.navigation?.notificationsUnreadCount,
    notificationsUnreadLabel: "Unread notifications",
    welcomeLabel: "Welcome",
    welcomePath:
      workspace.navigation && !workspace.navigation.welcomeHidden ? hubPath("/welcome") : null,
    settingsNavigationLabel: "Security and settings",
    securityAuditLabel: "Security audit",
    securityAuditPath: resourcePath("/settings/audit", search, { repositoryId: repository.id }),
    administrationLinks: [
      { section: "copilot", label: "Copilot connection", path: hubPath("/settings/copilot") },
      { section: "sessions", label: "End all Hub sessions", path: hubPath("/settings/sessions") },
      ...(workspace.capabilities?.administerHub
        ? [
            {
              section: "admins" as const,
              label: "Hub administrators",
              path: hubPath("/settings/admins"),
            },
            {
              section: "sharing" as const,
              label: "Public sharing",
              path: hubPath("/admin/sharing"),
            },
            { section: "github" as const, label: "GitHub App", path: hubPath("/settings/github") },
          ]
        : []),
    ],
    newPrototypeLabel: "Create",
    newPrototypePath: workspace.capabilities?.createPrototypes
      ? resourcePath(`/repositories/${repository.id}/new`, search)
      : null,
    prototypesLabel: "Prototypes",
    prototypesPath: resourcePath(`/repositories/${repository.id}`, search),
    repositories: workspace.repositories.map((item) => ({
      id: String(item.id),
      nameWithOwner: item.nameWithOwner,
      path: resourcePath(`/repositories/${item.id}`, search),
    })),
    repositoryMenuLabel: "Repositories",
    repositorySelectorLabel: `Choose repository. ${repository.nameWithOwner} selected`,
    selectedRepositoryId: String(repository.id),
    selectedSection: "prototypes",
    signOutLabel: "Sign out",
    signOutPath: "/session",
    systemThemeLabel: "System",
  }
}
