import type { GithubAppSetupHeaderData } from "@features/github-app-setup-header/types"

interface HubAdminEnrollmentPageBaseData extends GithubAppSetupHeaderData {
  canContinue?: boolean
  alert?: string | null
  pageTitle: string
  secretLabel: string
}

export type HubAdminEnrollmentPageData = HubAdminEnrollmentPageBaseData &
  (
    | {
        providerActions: Array<{
          label: string
          path: string
          provider: "github" | "entra"
        }>
        submitLabel?: never
        submitPath?: never
      }
    | {
        providerActions?: never
        submitLabel: string
        submitPath: string
      }
  )
