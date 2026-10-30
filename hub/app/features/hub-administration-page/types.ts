import type { HubAdministrationWorkspaceData } from "@features/hub-administration-workspace/types"
import type { HubWorkspaceData } from "@features/hub-workspace/types"

export interface HubAdministrationPageData {
  administrationWorkspace?: HubAdministrationWorkspaceData | null
  authenticatedWorkspace?: HubWorkspaceData | null
  heading: string
  description: string
  auditLabel: string
  auditPath: string | null
  githubAppLabel?: string
  githubAppPath?: string | null
  copilotConnectionLabel?: string
  copilotConnectionPath?: string | null
  hubAdminsLabel?: string
  hubAdminsPath?: string | null
  sharingSettingsLabel?: string
  sharingSettingsPath?: string | null
  repositoriesLabel: string
  repositoriesPath: string
  signOutLabel: string
  signOutPath: string
  signedOut?: boolean
  sessionRevocationLabel?: string
  sessionRevocationPath?: string | null
  authenticityToken: string
  notice: string | null
  alert: string | null
}
