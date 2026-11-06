import type { NoticeLevel, WizardPhase } from "../types.ts"

export interface Scene {
  id: string
  group: string
  title: string
  source: string
  kind: "cloud" | "text" | "field" | "select" | "confirm" | "wait" | "progress" | "shell"
  message: string
  purpose: string
  decision: string
  consequence: string
  phase: WizardPhase
  columns: number
  rows: number
  welcome?: boolean
  field?: "name" | "owner" | "resourceGroup" | "npmRegistry"
  initial?: string
  options?: { label: string; value: string }[]
  notice?: { level: NoticeLevel; message: string }
  history?: string[]
  inputs?: string[]
  fullscreen?: boolean
  configureOnly?: boolean
  complete?: boolean
  receipt?: "primary" | "remaining"
}

export interface RenderedScene extends Scene {
  ordinal: number
  label: string
  ansi: string
}

export interface Capture {
  png: Uint8Array
  transcript: string
}
