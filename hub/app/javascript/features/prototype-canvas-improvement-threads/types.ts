import type { RefObject } from "react"

export type ImprovementThread = {
  id: number
  revision: number
  author: string
  avatarUrl?: string | null
  body: string
  target: string
  path: string
  status: "open" | "sent" | "ready" | "blocked" | "resolved"
  originalPending: boolean
  retryStatus?: "sent" | "blocked"
  messages: {
    id: string
    role: "author" | "copilot"
    author?: string
    avatarUrl?: string | null
    body: string
    pending?: boolean
    status?: "open" | "sent" | "ready" | "blocked"
  }[]
  point?: { x: number | string; y: number | string }
}

export type ImprovementThreadsProps = {
  threads: ImprovementThread[]
  identity: string
  open: boolean
  active?: boolean
  controls?: boolean
  busy?: boolean
  activeBatch?: boolean
  error?: string
  returnFocusRef?: RefObject<HTMLElement | null>
  onOpen: () => void
  onClose: () => void
  onSelect?: (id: number) => void
  onInteractionChange?: (blocked: boolean) => void
  onFollowUp: (thread: ImprovementThread, body: string) => Promise<boolean>
  onResolve: (thread: ImprovementThread) => Promise<boolean>
  onDelete: (thread: ImprovementThread) => Promise<boolean>
  onFix: () => Promise<boolean>
  onRetry?: (thread: ImprovementThread) => Promise<boolean>
}
