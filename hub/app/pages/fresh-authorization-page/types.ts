import type { GithubAppSetupHeaderData } from "@features/github-app-setup-header/types"
import type { HubAdministrationWorkspaceData } from "@features/hub-administration-workspace/types"

export interface FreshAuthorizationPageData extends GithubAppSetupHeaderData {
  simulation?: boolean
  canContinue?: boolean
  administrationWorkspace?: HubAdministrationWorkspaceData | null
  pageTitle: string
  submitLabel: string
  submitPath: string
  authenticityToken: string
  cancelLabel?: string
  cancelPath?: string
  continuation?: { id: string; method: string }
}
