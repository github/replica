import { createContext } from "react"
import type { ReactNode } from "react"

export const WorkspaceCompletionContext = createContext<((page: ReactNode) => void) | null>(null)
