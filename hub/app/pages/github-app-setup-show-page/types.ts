import type { GithubAppSetupHeaderData } from "@features/github-app-setup-header/types"

export interface GithubAppSetupShowPageData extends GithubAppSetupHeaderData {
  simulation?: boolean
  canContinue?: boolean
  authenticityToken: string
  organizationHint: string
  organizationLabel: string
  pageTitle: string
  secretLabel: string
  submitLabel: string
  submitPath: string
}
