import type { HubAdministrationPageData } from "@features/hub-administration-page/types"

export interface GithubAppForm {
  action: string
  method: "patch" | "post" | "delete"
  operation?: "start" | "retry"
  submitLabel: string
  confirmLabel: string
  disabled: boolean
  blockedLabel?: string | null
  confirmationPhraseLabel?: string
  credentials?: {
    secretLabel: string
    keyLabel: string
    limits: string
  }
}

export interface GithubAppPageData extends HubAdministrationPageData {
  pageTitle: string
  configurationId: number | null
  version: number | null
  identity: string | null
  installation: string | null
  busyLabel: string | null
  verification: string
  paragraphs: string[]
  links: { label: string; path: string }[]
  form: GithubAppForm | null
}
