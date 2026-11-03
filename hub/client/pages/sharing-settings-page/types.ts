import type { HubAdministrationPageData } from "@features/hub-administration-page/types"

type SharedData = HubAdministrationPageData & {
  emptyLabel: string
}

export type SharingSettingsPageData =
  | (SharedData & { accessDenied: true })
  | (SharedData & {
      accessDenied: false
      statusLabel: string
      operation: "enable" | "disable"
      submitPath: string
      submitLabel: string
      consequence: string
      confirmLabel: string
      verification: string
    })
