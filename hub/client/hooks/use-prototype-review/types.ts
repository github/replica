import type { RefObject } from "react"
import type { ReviewCommentsTransport } from "@hooks/use-review-comments/use-review-comments-client/types"
import type { ReviewCommentFilters } from "@utils/review-comment/types"

export interface PrototypeReviewOptions {
  authenticityToken: string
  iframeRef: RefObject<HTMLIFrameElement | null>
  previewTheme: "light" | "dark"
  prototypeId: number
  repositoryId: number
  reviewCommentsPath: string
  viewerLogin: string
  transport?: ReviewCommentsTransport
  filters?: ReviewCommentFilters
  onFiltersChange?: (filters: ReviewCommentFilters) => void
  selectedThreadId?: number | null
  onSelectedThreadChange?: (id: number | null) => void
  selectedBuild?: {
    number: number
    previewUrl: string
  }
}
