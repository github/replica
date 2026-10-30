import type { RefObject } from "react"

export interface PrototypeReviewOptions {
  authenticityToken: string
  iframeRef: RefObject<HTMLIFrameElement | null>
  previewTheme: "light" | "dark"
  prototypeId: number
  repositoryId: number
  reviewCommentsPath: string
  viewerLogin: string
  selectedBuild?: {
    number: number
    previewUrl: string
  }
}
