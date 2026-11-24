import { createContext } from "react"

export const WorkspaceInboxCountContext = createContext<
  ((count: number | null) => void) | undefined
>(undefined)
