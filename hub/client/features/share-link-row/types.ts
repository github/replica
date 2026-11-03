import type { ReactNode } from "react"

export interface ShareLinkDisplayData {
  buildLabel: ReactNode
  createdAt?: string
  createdLabel?: string
  expiresAt: string | null
  expiresLabel: string
  id: number
  label: string
  url: string
}

export interface ShareLinkRowProps {
  shareLink: ShareLinkDisplayData
  className?: string
  copiedLabel: string
  copyErrorLabel: string
  copyLabel: string
  urlLabel?: string
  unavailableLabel?: string
  highlighted?: boolean
  children: ReactNode
}
