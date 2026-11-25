import { SlidersIcon } from "@primer/octicons-react"
import type { Ref } from "react"

import { HubIconButton } from "@components/hub-icon-button"
import { ShortcutTooltip } from "@components/shortcut-tooltip"

import { copy } from "@utils/prototype-canvas/en"

export function ControlsToggle({
  open,
  onToggle,
  buttonRef,
  shortcut = false,
}: {
  open?: boolean
  onToggle: () => void
  buttonRef?: Ref<HTMLButtonElement>
  shortcut?: boolean
}) {
  const button = (
    <HubIconButton
      icon={SlidersIcon}
      aria-label={copy.controls}
      description={shortcut ? undefined : copy.controls}
      title={shortcut ? "" : undefined}
      aria-keyshortcuts={shortcut ? "O" : undefined}
      ref={buttonRef}
      size="small"
      variant="default"
      className="canvas-controls-toggle"
      aria-expanded={open}
      onClick={onToggle}
    />
  )
  return shortcut ? (
    <ShortcutTooltip ref={buttonRef} text={copy.controls} shortcut="O" type="description">
      {button}
    </ShortcutTooltip>
  ) : (
    button
  )
}
