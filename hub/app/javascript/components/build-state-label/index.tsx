import { StopIcon } from "@primer/octicons-react"
import { Label } from "@primer/react-brand/esm"

import { HubSpinner } from "@components/hub-spinner"

import type { BuildStateLabelProps } from "./types"

import "./styles.css"

const stateVariants = {
  failed: "red",
  queued: "gray",
  running: "gray",
  successful: "green",
  superseded: "default",
} as const

/** Shows each Build state with a consistent label color. */
export function BuildStateLabel({ label, state }: BuildStateLabelProps) {
  return (
    <Label
      className={`build-state-label build-state-label--${state}`}
      color={stateVariants[state]}
      size="small"
      leadingVisual={
        state === "running" ? (
          <HubSpinner decorative size="small" />
        ) : state === "failed" ? (
          <StopIcon size={12} />
        ) : undefined
      }
    >
      {label}
    </Label>
  )
}
