import type { ShareLinkDisplayData } from "@features/share-link-row/types"

export interface ShareLinkData extends ShareLinkDisplayData {
  createdAt: string
  createdLabel: string
  deletePath: string
  deletePrompt: string
}

export interface ShareLinkItemProps {
  controlQuery?: string
  managementBuildNumber?: number
  authenticityToken: string
  shareLink: ShareLinkData
  copiedLabel: string
  copyErrorLabel: string
  copyLabel: string
  deleteLabel: string
  openLabel: string
}
