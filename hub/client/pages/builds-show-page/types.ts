import type { BuildState } from "@components/build-state-label/types"
import type { PrototypeWorkspaceData } from "@features/prototype-workspace"

interface BuildScreenshot {
  alt: string
  label: string
  src: string
  darkSrc?: string
}

export interface BuildsShowPageData extends PrototypeWorkspaceData {
  commitAuthor: {
    avatarUrl: string | null
    label: string
    url: string | null
  }
  commitHeading: string
  commitSha: string
  createdAt: string
  createdLabel: string
  desktopScreenshot?: BuildScreenshot
  failureHeading?: string
  failureSummary?: string
  finishedAt?: string
  finishedLabel?: string
  heading: string
  pageTitle: string
  publicationHeading?: string
  previewLabel?: string
  previewPath?: string
  retainedSizeLabel?: string
  screenshotsHeading?: string
  startedAt?: string
  startedLabel?: string
  state: BuildState
  stateLabel: string
  timelineHeading: string
  narrowScreenshot?: BuildScreenshot
  workflowCompletedAt?: string
  workflowCompletedLabel?: string
  workflowHeading?: string
  workflowLabel?: string
  workflowUrl?: string
}
