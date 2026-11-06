import type { HubAdministrationPageData } from "@features/hub-administration-page/types"

type SharedData = HubAdministrationPageData & {
  emptyLabel: string
}

/** One change an administrator confirms: what happens, and what they must check first. */
export interface CopilotConnectionChange {
  label: string
  consequence: string
  confirmLabel: string
  verification: string
}

export type CopilotConnectionPageData =
  | (SharedData & { accessDenied: true })
  | (SharedData & {
      accessDenied: false
      connected: boolean
      statusLabel: string
      submitPath: string
      tokenLabel: string | null
      connectedBy?: string
      verifiedLabel?: string
      usageLabel?: string
      refusedLabel?: string | null
      connect: CopilotConnectionChange | null
      disconnect?: CopilotConnectionChange
    })
