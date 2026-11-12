import type { RefObject } from "react"

export type PreviewRoute = { pathname: string; search: string; hash: string }
export type PreviewNavigation = { input: string; entries: string[]; index: number }
export type PendingPreviewClick = RefObject<(() => void) | null>
