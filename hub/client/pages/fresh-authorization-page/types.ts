import type { GithubAppSetupHeaderData } from "@features/github-app-setup-header/types"
import type { HubAdministrationWorkspaceData } from "@features/hub-administration-workspace/types"

export interface FreshAuthorizationPageData extends GithubAppSetupHeaderData {
  canContinue?: boolean
  administrationWorkspace?: HubAdministrationWorkspaceData | null
  pageTitle: string
  submitLabel: string
  submitPath: string
  authenticityToken: string
  cancelLabel?: string
  cancelPath?: string
  continuation?: { id: string; method: string }
  roleChange?: {
    operationLabel: string
    targets: Array<{
      membershipId: string
      providerLabel: string
      login: string | null
      name: string | null
    }>
  }
}
