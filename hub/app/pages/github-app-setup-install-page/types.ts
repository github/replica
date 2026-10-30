import type { GithubAppSetupHeaderData } from "@features/github-app-setup-header/types"

export interface GithubAppSetupInstallPageData extends GithubAppSetupHeaderData {
  simulation?: boolean
  pageTitle: string
  submitPath?: string
  submitLabel?: string
  canContinue?: boolean
  nextPath?: string
  nextLabel?: string
}
