import type { GithubAppSetupHeaderData } from "@features/github-app-setup-header/types"

export interface HubAdminEnrollmentPageData extends GithubAppSetupHeaderData {
  canContinue?: boolean
  pageTitle: string
  secretLabel: string
  submitLabel: string
  submitPath: string
  authenticityToken: string
}
