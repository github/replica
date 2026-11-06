import type { AnchorPoint, AnchorRectangle } from "@utils/review-anchor/types"

export interface ReviewCardPositionOptions {
  anchorPoint: AnchorPoint
  anchorRectangle?: AnchorRectangle
  anchorSelector?: string
  layoutKey: string
  preserveVerticalSide?: boolean
}

export interface ReviewCardPosition {
  left: number
  top: number
}
