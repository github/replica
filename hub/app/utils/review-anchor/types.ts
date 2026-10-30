import type { z } from "zod"

import type {
  ANCHOR_POINT_SCHEMA,
  ANCHOR_RECTANGLE_SCHEMA,
  ANCHOR_RESOLUTION_SCHEMA,
  ANCHOR_VIEWPORT_SCHEMA,
  AREA_ANCHOR_SCHEMA,
  AREA_ELEMENT_CONTEXT_SCHEMA,
  ELEMENT_ANCHOR_SCHEMA,
  REVIEW_ANCHOR_SCHEMA,
  REVIEW_ROUTE_SCHEMA,
} from "./schemas"

export type ReviewRoute = z.infer<typeof REVIEW_ROUTE_SCHEMA>
export type AnchorRectangle = z.infer<typeof ANCHOR_RECTANGLE_SCHEMA>
export type AnchorPoint = z.infer<typeof ANCHOR_POINT_SCHEMA>
export type AnchorViewport = z.infer<typeof ANCHOR_VIEWPORT_SCHEMA>
export type ElementAnchor = z.infer<typeof ELEMENT_ANCHOR_SCHEMA>
export type AreaElementContext = z.infer<typeof AREA_ELEMENT_CONTEXT_SCHEMA>
export type AreaAnchor = z.infer<typeof AREA_ANCHOR_SCHEMA>
export type ReviewAnchor = z.infer<typeof REVIEW_ANCHOR_SCHEMA>

export interface AnchorReference {
  commentId: number
  originBuild: boolean
  anchor: ReviewAnchor
}

export type AnchorResolution = z.infer<typeof ANCHOR_RESOLUTION_SCHEMA>
