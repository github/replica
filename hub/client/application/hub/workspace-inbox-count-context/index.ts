import { createContext } from "react"

export const WorkspaceInboxCountContext = createContext<((count: number) => void) | undefined>(
  undefined,
)
