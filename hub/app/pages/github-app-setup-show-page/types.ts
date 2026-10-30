import type { GithubAppSetupHeaderData } from "@features/github-app-setup-header/types"

export interface GithubAppSetupShowPageData extends GithubAppSetupHeaderData {
  authenticityToken: string
  organizationHint: string
  organizationLabel: string
  pageTitle: string
  secretLabel: string
  submitLabel: string
  submitPath: string
}
