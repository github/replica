import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"
import type { HubAdministrationWorkspaceData } from "@features/hub-administration-workspace/types"

export interface SecurityAuditPageData {
  pageTitle: string
  heading: string
  description: string
  notice: string | null
  scopeLabel: string
  selectedScopeId: string
  scopes: Array<{ id: string; label: string; path: string }>
  scopesUnavailableMessage?: string | null
  retention: string
  emptyLabel: string
  nextLabel: string
  nextPath: string | null
  repositoriesLabel: string
  repositoriesPath: string
  hubAdminsLabel?: string
  hubAdminsPath?: string | null
  sharingSettingsLabel?: string
  sharingSettingsPath?: string | null
  sessionRevocationLabel?: string
  sessionRevocationPath?: string | null
  githubAppLabel?: string
  githubAppPath?: string | null
  copilotConnectionLabel?: string
  copilotConnectionPath?: string | null
  signOutLabel: string
  signOutPath: string
  authenticityToken: string
  columns: Record<"time" | "action" | "actor" | "ip" | "context" | "outcome", string>
  events: {
    id: number
    time: string
    action: string
    actor: string
    ip: string
    context: string
    outcome: string
  }[]
  workspace?: RepositoryWorkspaceData
  administrationWorkspace?: HubAdministrationWorkspaceData | null
}
