import { Tooltip } from "@primer/react-brand/esm"
import type { ComponentProps } from "react"

import "./styles.css"

export function ShortcutTooltip({
  shortcut,
  className,
  ...props
}: ComponentProps<typeof Tooltip> & { shortcut: string }) {
  return (
    <Tooltip
      {...props}
      className={`hub-shortcut-tooltip${className ? ` ${className}` : ""}`}
      data-shortcut={shortcut}
    />
  )
}
