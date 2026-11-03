import { useEffect, useRef } from "react"
import type { ReactNode } from "react"

import { XIcon } from "@primer/octicons-react"
import { Heading, Text } from "@primer/react-brand"

import { HubIconButton } from "@components/hub-icon-button"

import "./styles.css"

/** Heads the prototype collection and filters its contents. */
export function PrototypeIndexHeader({
  action,
  clearSearchLabel,
  heading,
  headingAs = "h1",
  onSearchChange,
  onSearchSubmit,
  searchLabel,
  searchQuery,
  searchMaxLength,
  searchShortcutEnabled = true,
  tools,
  trailingTools,
}: {
  action?: ReactNode
  clearSearchLabel: string
  heading: string
  headingAs?: "h1" | "h2"
  onSearchChange: (query: string) => void
  onSearchSubmit?: () => void
  searchLabel: string
  searchQuery: string
  searchMaxLength?: number
  searchShortcutEnabled?: boolean
  tools?: ReactNode
  trailingTools?: ReactNode
}) {
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!searchShortcutEnabled) return

    function focusSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }

    window.addEventListener("keydown", focusSearch)
    return () => window.removeEventListener("keydown", focusSearch)
  }, [searchShortcutEnabled])

  return (
    <header className="repository-page-header prototype-index-header">
      <div className="prototype-index-header__title-bar">
        <Heading as={headingAs} size="6" className="prototype-index-header__heading">
          {heading}
        </Heading>

        {action ? <div className="prototype-index-header__action">{action}</div> : null}
      </div>

      <div className="prototype-index-header__tools">
        {tools}

        <div className="prototype-index-header__search">
          <input
            ref={searchInputRef}
            type="search"
            aria-label={searchLabel}
            aria-keyshortcuts="Meta+K Control+K"
            autoComplete="off"
            placeholder={searchLabel}
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            maxLength={searchMaxLength}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault()
                onSearchSubmit?.()
              }
            }}
          />
          {searchQuery ? (
            <HubIconButton
              className="prototype-index-header__clear-search"
              icon={XIcon}
              variant="invisible"
              size="small"
              aria-label={clearSearchLabel}
              onClick={() => {
                onSearchChange("")
                searchInputRef.current?.focus()
              }}
            />
          ) : null}
          <kbd aria-hidden="true">
            <span className="prototype-index-header__shortcut-symbol">⌘</span>
            <Text
              as="span"
              font="monospace"
              weight="semibold"
              className="prototype-index-header__shortcut-key"
            >
              K
            </Text>
          </kbd>
        </div>

        {trailingTools ? (
          <div className="prototype-index-header__trailing-tools">{trailingTools}</div>
        ) : null}
      </div>
    </header>
  )
}
