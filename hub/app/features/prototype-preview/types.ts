import type { PropsWithChildren, RefObject } from "react"

export interface PrototypePreviewCopy {
  previewUrlLabel: string
  copyPreviewUrlLabel: string
  copiedPreviewUrlLabel: string
  copyPreviewUrlErrorLabel: string
  openInNewTabLabel: string
}

export type PrototypePreviewProps = PropsWithChildren<{
  address: string
  externalAddress?: string
  copy: Omit<PrototypePreviewCopy, "openInNewTabLabel"> & { openInNewTabLabel?: string }
  iframeRef: RefObject<HTMLIFrameElement | null>
  previewUrl: string
  frameTitle: string
  previewTheme: "light" | "dark"
  modalOpen?: boolean
  onLoad?: () => void
  minimized?: boolean
  minimize?: { label: string; onClick: () => void }
  controlsIdentity?: string
  controlsToolbar?: HTMLElement | null
  minimizedControlsToolbar?: HTMLElement | null
}>
