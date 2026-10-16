import type { ReviewAnchor } from "@utils/review-anchor/types"

export type Route = string
export type Rect = { x: number; y: number; width: number; height: number }
export type Target = {
  id: string
  label: string
  route: Route
  rect: Rect
}
export type Note = {
  id: number
  kind: "improvement_note"
  author: string
  localId?: string
  result?: string
  body: string
  route: Route
  target: string
  selector: string | null
  rect: Rect
  capture: string
  anchor?: ReviewAnchor
  capturePlaceholder?: boolean
  status: "open" | "sent" | "ready" | "resolved" | "blocked"
  sync: "local" | "synced" | "failed"
  revision: number
}
export type Selection = Pick<
  Note,
  "route" | "target" | "selector" | "rect" | "capture" | "anchor" | "capturePlaceholder"
> & { identity?: string; noteRevision?: number; originalBody?: string }
