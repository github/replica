import { SlidersIcon } from "@primer/octicons-react"
import type { Ref } from "react"

import { HubIconButton } from "@components/hub-icon-button"

import { copy } from "@utils/prototype-canvas/en"

export function ControlsToggle({
  open,
  onToggle,
  buttonRef,
}: {
  open?: boolean
  onToggle: () => void
  buttonRef?: Ref<HTMLButtonElement>
}) {
  return (
    <HubIconButton
      icon={SlidersIcon}
      aria-label={copy.controls}
      description={copy.controls}
      ref={buttonRef}
      size="small"
      variant="default"
      className="canvas-controls-toggle"
      aria-expanded={open}
      onClick={onToggle}
    />
  )
}
