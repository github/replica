import { AppsIcon, ListUnorderedIcon } from "@primer/octicons-react"

import { HubSegmentedControl } from "@components/hub-segmented-control"
import type { PrototypeViewMode } from "./types"

/** Switches the prototype collection between gallery and list layouts. */
export function PrototypeViewModeControl({
  ariaLabel,
  galleryLabel,
  listLabel,
  onChange,
  value,
}: {
  ariaLabel: string
  galleryLabel: string
  listLabel: string
  onChange: (value: PrototypeViewMode) => void
  value: PrototypeViewMode
}) {
  const options = [
    { value: "gallery", label: galleryLabel, icon: AppsIcon },
    { value: "list", label: listLabel, icon: ListUnorderedIcon },
  ] as const

  return (
    <HubSegmentedControl
      aria-label={ariaLabel}
      options={options}
      value={value}
      variant="icon"
      onChange={onChange}
    />
  )
}
