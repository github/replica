import type { AnchorPoint } from "@utils/review-anchor/types"
import type { ReviewCommentsCopy } from "@utils/review-comment/types"

export interface ReviewCommentComposerProps {
  anchorPoint: AnchorPoint
  bodyMaximumBytes: number
  copy: ReviewCommentsCopy
  creating: boolean
  submitError?: string
  onSubmit: (body: string) => Promise<boolean>
  onDiscard: () => void
}
