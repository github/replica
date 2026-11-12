import type { AnchorResolution } from "@utils/review-anchor/types"

export const resolvedAnchor: AnchorResolution = {
  commentId: 1,
  status: "resolved",
  rect: { x: 120, y: 160, width: 120, height: 40 },
  point: { x: 180, y: 180 },
}

export const movedAnchor: AnchorResolution = {
  commentId: 1,
  status: "moved",
  rect: { x: 180, y: 220, width: 120, height: 40 },
  point: { x: 240, y: 240 },
}
