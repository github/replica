import type { HubAdministrationPageData } from "@features/hub-administration-page/types"

type SharedData = HubAdministrationPageData & { emptyLabel: string }

export type BuildSettingsPageData =
  | (SharedData & { accessDenied: true })
  | (SharedData & {
      accessDenied: false
      maximumPackageMib: string
      limitLabel: string
      limitDescription: string
      submitPath: string
      submitLabel: string
      confirmLabel: string
      verification: string
    })
