import type { GithubAppSetupHeaderData } from "@features/github-app-setup-header/types"

export interface HubAdminEnrollmentPageData extends GithubAppSetupHeaderData {
  canContinue?: boolean
  alert?: string | null
  pageTitle: string
  providerActions: Array<{
    label: string
    path: string
    provider: "github" | "entra"
  }>
  secretLabel: string
}
