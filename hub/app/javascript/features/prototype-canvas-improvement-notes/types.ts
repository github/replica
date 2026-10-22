import type { ReviewAnchor } from "@utils/review-anchor/types"

export type Rect = { x: number; y: number; width: number; height: number }
export type Note = {
  id: number
  kind: "improvement_note"
  author: string
  localId: string
  body: string
  route: string
  target: string
  selector: string | null
  rect: Rect
  anchor?: ReviewAnchor
  status: "open" | "sent" | "ready" | "resolved" | "blocked"
  sync: "local" | "synced" | "failed"
  revision: number
  thread: {
    originalAuthor?: { id: number; login: string; avatarUrl: string | null }
    originalStatus: "open" | "sent" | "ready" | "blocked"
    messages: (
      | {
          id: string
          role: "author"
          body: string
          status: "open" | "sent" | "ready" | "blocked"
          author?: { id: number; login: string; avatarUrl: string | null }
        }
      | {
          id: string
          role: "copilot"
          body: string
          status: "ready" | "blocked"
          requestIds: string[]
        }
    )[]
  }
}
