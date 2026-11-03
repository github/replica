import { XIcon } from "@primer/octicons-react"
import { Heading } from "@primer/react-brand"

import { HubIconButton } from "../hub-icon-button"
import type { HubSidebarProps } from "./types"

import "./styles.css"

export function HubSidebar({
  title,
  label = title,
  open,
  closeLabel,
  closeDisabled = false,
  closeShortcut,
  closeRef,
  onClose,
  headerAccessory,
  className,
  contentClassName,
  children,
}: HubSidebarProps) {
  return (
    <aside
      className={`hub-sidebar${className ? ` ${className}` : ""}`}
      aria-label={label}
      aria-hidden={!open}
      data-open={open}
      inert={!open}
    >
      <header className="hub-sidebar__header">
        <div className="hub-sidebar__heading">
          <Heading as="h2" size="subhead-medium" weight="normal">
            {title}
          </Heading>
          {headerAccessory}
        </div>
        <HubIconButton
          ref={closeRef}
          icon={XIcon}
          aria-label={closeLabel}
          aria-keyshortcuts={closeShortcut}
          title={closeLabel}
          description={closeLabel}
          variant="invisible"
          size="small"
          className="hub-sidebar__close"
          disabled={closeDisabled}
          onClick={onClose}
        />
      </header>
      <div className={`hub-sidebar__content${contentClassName ? ` ${contentClassName}` : ""}`}>
        {children}
      </div>
    </aside>
  )
}
