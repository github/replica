import type { WorkspaceAccountData } from "@components/workspace-navigation/types"
import type { NotificationInboxConfiguration } from "@utils/notification/types"

export interface RepositoryNavigationContext {
  analyticsLabel?: string
  analyticsPath?: string | null
  learningsLabel?: string
  learningsPath?: string | null
  newPrototypeLabel: string
  newPrototypePath: string | null
  prototypesLabel: string
  prototypesPath: string
  repositories: Array<{ id: string; nameWithOwner: string; path: string }>
  repositoryMenuLabel: string
  repositorySelectorLabel: string
  selectedRepositoryId: string
}

export interface WorkspaceNavData extends WorkspaceAccountData {
  emptyRepositoryLabel?: string
  welcomeLabel?: string
  welcomePath?: string | null
  notificationInbox?: NotificationInboxConfiguration
  notificationsLabel?: string
  notificationsPath?: string
  notificationsUnread?: boolean
  inboxPreviewScope?: string
  navigationLabel: string
  settingsNavigationLabel?: string
  selectedSection?:
    | "welcome"
    | "new"
    | "prototypes"
    | "analytics"
    | "canvas"
    | "notifications"
    | "learnings"
    | "security"
    | "audit"
    | "admins"
    | "sharing"
    | "sessions"
    | "github"
    | "copilot"
  repository?: RepositoryNavigationContext | null
  repositoriesLabel?: string
  repositoriesPath?: string
  administrationLinks?: Array<{
    section: "admins" | "sharing" | "sessions" | "github" | "copilot"
    label: string
    path: string
  }>
  securityAuditLabel?: string
  securityAuditPath?: string | null
  canvasConnectionsPath?: string
}
