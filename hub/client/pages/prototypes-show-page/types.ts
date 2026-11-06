import type { RefObject } from "react"
import type { MentionSource } from "@hooks/use-mention-source/context"

import type { CopilotAppContinuationCopy } from "@components/copilot-app-continuation/types"
import type { PrototypeWorkspaceData } from "@features/prototype-workspace"
import type { PreviewBridgeState } from "@hooks/use-preview-bridge/types"
import type { usePrototypeReview } from "@hooks/use-prototype-review"
import type { ReviewCommentsCopy } from "@utils/review-comment/types"

export interface PrototypesShowPageData extends PrototypeWorkspaceData {
  buildPinned: boolean
  mentionCandidatesPath?: string
  mentionCopy?: MentionSource["copy"]
  initialCommentId?: number
  initialNotificationId?: number
  notificationErrorLabel?: string
  controlsIdentity?: string
  prototypeName: string
  prototypeDescription: string | null
  showPrototypeInfo: boolean
  alert?: string | null
  detailsEditPath?: string
  editDetailsLabel?: string
  editDetailsHeading?: string
  nameLabel?: string
  startPage?: string | null
  startPageLabel?: string
  startPageHint?: string
  saveDetailsLabel?: string
  cancelEditLabel?: string
  nameMaximumLength?: number
  descriptionMaximumLength?: number
  descriptionLabel: string
  noDescriptionLabel: string
  prototypeInfoLabel: string
  dismissInfoLabel: string
  closeInfoLabel: string
  branchFromHereLabel: string
  forkLabel: string
  branchFromLabel: string
  branchPlaceholder: string
  branchSubmitLabel: string
  branchSubmissionMode: "copilot" | "disabled"
  branchInstructions: string
  branchPageInstructions: string
  branchContinuation: CopilotAppContinuationCopy
  emptyHeading: string
  emptyLabel: string
  previewUrlLabel: string
  copyPreviewUrlLabel: string
  copiedPreviewUrlLabel: string
  copyPreviewUrlErrorLabel: string
  openInNewTabLabel: string
  minimizeHubLabel: string
  maximizeHubLabel: string
  dragControlsLabel: string
  minimizedPreview: boolean
  pageTitle: string
  prototypeId: number
  repositoryId: number
  repositoryName: string
  reviewCommentsPath: string
  reviewReadOnly?: boolean
  reviewComments: {
    bodyMaximumBytes: number
    copy: ReviewCommentsCopy
  }
  selectedBuild?: NonNullable<PrototypeWorkspaceData["selectedBuild"]> & {
    frameTitle: string
    previewUrl: string
  }
}

export interface PrototypeDetailsInput {
  name: string
  description: string | null
}

export interface PrototypeDetailsControls {
  onSaveDetails?: (details: PrototypeDetailsInput) => void
  savingDetails?: boolean
  detailsError?: string | null
  detailsSaved?: boolean
}

export interface PrototypesShowPageProps extends PrototypeDetailsControls {
  data: PrototypesShowPageData
  iframeRef: RefObject<HTMLIFrameElement | null>
  previewTheme: "light" | "dark"
  review: ReturnType<typeof usePrototypeReview>
  previewBridge?: never
  reviewUnavailableLabel?: never
  initialInfoOpen?: boolean
  initialComposerExpanded?: boolean
  onOpenApp?: (url: string) => void
  viewerUrl?: string
  minimized?: boolean
  initialMinimized?: boolean
  onMinimizedChange?: (minimized: boolean) => void
}

export interface PrototypePreviewOnlyPageProps extends Omit<
  PrototypesShowPageProps,
  "review" | "previewBridge" | "reviewUnavailableLabel"
> {
  review?: never
  previewBridge: PreviewBridgeState
  reviewUnavailableLabel: string
}
