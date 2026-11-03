import { Label } from "@primer/react-brand"

import type { BuildStateLabelProps } from "./types"

const stateVariants = {
  failed: "red",
  queued: "gray",
  running: "orange",
  successful: "green",
  superseded: "default",
} as const

/** Shows each Build state with a consistent label color. */
export function BuildStateLabel({ label, state }: BuildStateLabelProps) {
  return (
    <Label color={stateVariants[state]} size="small">
      {label}
    </Label>
  )
}
