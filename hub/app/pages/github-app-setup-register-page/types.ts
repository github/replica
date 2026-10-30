import type { GithubAppSetupHeaderData } from "@features/github-app-setup-header/types"

export interface GithubAppSetupRegisterPageData extends GithubAppSetupHeaderData {
  simulation?: boolean
  canContinue?: boolean
  access: string
  manifest: string
  pageTitle: string
  submitLabel: string
  submitPath: string
}
