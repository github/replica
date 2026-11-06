import type { RefObject } from "react"

import type { CopilotAppContinuationCopy } from "@components/copilot-app-continuation/types"
import type { PrototypePreviewCopy } from "@features/prototype-preview/types"
import type { ReplicaWorkspaceData } from "@features/prototype-workspace"
import type { ReviewRoute } from "@utils/review-anchor/types"

export interface ReplicaBrowsePageData
  extends ReplicaWorkspaceData, Omit<PrototypePreviewCopy, "openInNewTabLabel"> {
  browseReplica: true
  templateId: string
  pageTitle: string
  repositoryName: string
  minimizeHubLabel: string
  maximizeHubLabel: string
  dragControlsLabel: string
  minimizedPreview: boolean
  controlsIdentity?: string
  forkLabel: string
  branchFromLabel: string
  branchPlaceholder: string
  branchSubmitLabel: string
  branchSubmissionMode: "copilot" | "copy"
  branchInstructions: string
  branchPageInstructions: string
  templateLandingPageInstructions?: string
  branchContinuation: CopilotAppContinuationCopy
  emptyHeading: string
  emptyLabel: string
  selectedBuild?: NonNullable<ReplicaWorkspaceData["selectedBuild"]> & {
    previewUrl: string
    frameTitle: string
  }
}

export interface ReplicaBrowsePageProps {
  data: ReplicaBrowsePageData
  iframeRef: RefObject<HTMLIFrameElement | null>
  previewTheme: "light" | "dark"
  route?: ReviewRoute | null
  viewerUrl?: string
  minimized?: boolean
  initialMinimized?: boolean
  onMinimizedChange?: (minimized: boolean) => void
  onFrameLoad?: () => void
  onOpenApp?: (url: string) => void
}
