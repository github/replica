export type BuildState = "failed" | "queued" | "running" | "successful" | "superseded"

export interface BuildStateLabelProps {
  label: string
  state: BuildState
}
