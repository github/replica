import type { FieldDefinition, NoticeLevel, WizardPhase } from "../types.ts"

export type Question =
  | { kind: "cloud"; resolve: (value: "azure") => void }
  | { kind: "text"; message: string; initial: string; resolve: (value: string) => void }
  | { kind: "field"; field: FieldDefinition; initial: string; resolve: (value: string) => void }
  | {
      kind: "select"
      message: string
      options: { label: string; value: string }[]
      resolve: (value: string) => void
    }
  | { kind: "confirm"; message: string; resolve: (value: boolean) => void }
  | {
      kind: "multi-select"
      message: string
      options: { label: string; value: string }[]
      initial: string[]
      resolve: (value: string[]) => void
    }
  | { kind: "wait"; message: string; resolve: () => void }

export interface TerminalView {
  question?: Question
  revision: number
  feedback: number
  history: string[]
  notice?: { level: NoticeLevel; message: string }
  phase: WizardPhase
  complete: boolean
  welcome: boolean
  removing?: boolean
}
