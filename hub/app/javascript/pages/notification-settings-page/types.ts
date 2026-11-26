import type { HubWorkspaceData } from "@features/hub-workspace/types"

export interface NotificationSettingsPageData extends HubWorkspaceData {
  heading: string
  description: string
  enabled: boolean
  enabledLabel: string
  explanation: string
  privacy: string
  pausedMessage: string | null
  submitPath: string
  saveLabel: string
  alert?: string | null
  mutedHeading: string
  mutedEmpty: string
  prototypeExplanation: string
  mutes: Array<{
    id: number
    repository: string
    prototype: string
    path: string
    submitPath: string
    unmuteLabel: string
  }>
  administration: {
    heading: string
    description: string
    status: string
    submitPath: string
    operation: "enable" | "disable"
    submitLabel: string
    confirmLabel: string
    failureMessage: string | null
  } | null
}
