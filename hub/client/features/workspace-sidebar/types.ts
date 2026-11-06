import type { WorkspaceAccountData } from "@components/workspace-navigation/types"
import type { useNotificationInbox } from "@hooks/use-notification-inbox"
import type { NotificationInboxConfiguration, RepositoryInboxData } from "@utils/notification/types"

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

export interface WorkspaceSidebarData extends WorkspaceAccountData, RepositoryInboxData {
  welcomeLabel?: string
  welcomePath?: string | null
  notificationsPath?: string
  liveInbox?: ReturnType<typeof useNotificationInbox> & {
    copy: NotificationInboxConfiguration["copy"]
  }
  navigationLabel: string
  settingsNavigationLabel?: string
  selectedSection?:
    | "welcome"
    | "new"
    | "prototypes"
    | "analytics"
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
}
