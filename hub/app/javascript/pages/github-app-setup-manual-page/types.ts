import type { GithubAppSetupHeaderData } from "@features/github-app-setup-header/types"

export interface GithubAppSetupManualPageData extends GithubAppSetupHeaderData {
  pageTitle: string
  authenticityToken: string
  submitPath: string
  submitLabel: string
  confirmLabel: string
  keyLabel: string
  keyHint: string
  error?: string | null
  instructions: { title: string; body: string }[]
  settings: { label: string; value: string }[]
  permissions: { label: string; value: string }[]
  fields: { name: string; label: string; hint: string; secret: boolean }[]
}
