import type { RefObject } from "react"

import type {
  AnchorReference,
  AnchorResolution,
  ReviewAnchor,
  ReviewRoute,
} from "@utils/review-anchor/types"

export type ReviewSelectionMode = "element" | "area"
export type ReviewSelectionFailure = "element-unavailable" | "area-too-small" | "area-unavailable"

export interface PreviewBridgeOptions {
  iframeRef: RefObject<HTMLIFrameElement | null>
  previewUrl?: string
  previewTheme: "light" | "dark"
  anchors: AnchorReference[]
  reviewEnabled?: boolean
  onSelectionStart?: () => void
  onToggleSidebar?: () => void
  selectionBlocked?: boolean
}

export interface PreviewBridgeState {
  ready: boolean
  route: ReviewRoute | null
  selecting: boolean
  selectionMode: ReviewSelectionMode | null
  selectedAnchor: ReviewAnchor | null
  selectionFailure: ReviewSelectionFailure | null
  resolutions: Map<number, AnchorResolution>
  handleFrameLoad: () => void
  startElementSelection: () => void
  startAreaSelection: () => void
  cancelSelection: () => void
  clearSelection: () => void
  focusAnchor: (commentId: number) => void
}
