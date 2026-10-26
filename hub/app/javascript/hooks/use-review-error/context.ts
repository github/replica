import { createContext } from "react"

export const ReviewErrorContext = createContext<{
  report: (id: string, message: string) => void
  registerDialog: (dialog: HTMLDialogElement) => () => void
} | null>(null)
