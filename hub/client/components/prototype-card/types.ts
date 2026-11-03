import type { BuildState } from "@components/build-state-label/types"

export interface PrototypeCardData {
  author: {
    avatarUrl: string | null
    label: string
    ownerLabel: string
    url: string | null
  }
  branchName: string
  name: string
  description: string | null
  id: string
  latestBuild?: {
    state: BuildState
    stateLabel: string
  }
  path: string
  previewFallbackLabel?: string
  reviewBuild?: {
    number: number
    screenshotAlt: string
    screenshotSrc: string
    darkScreenshotSrc?: string
  }
}
