import { ActionMenu } from "@primer/react-brand"
import type { ComponentProps, KeyboardEvent } from "react"

import type { PrototypeWorkspaceHeaderData } from "../types"

export function BuildMenuOption({
  build,
  path,
  selected,
  onKeyDown,
  handler,
  type,
}: Pick<ComponentProps<typeof ActionMenu.Item>, "handler" | "type"> & {
  build: PrototypeWorkspaceHeaderData["buildOptions"][number]
  path: string
  selected: boolean
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
}) {
  return (
    <ActionMenu.Item
      as="a"
      href={path}
      value={String(build.number)}
      type={type}
      className="review-shell__build-option"
      aria-current={selected ? "page" : undefined}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        const link =
          event.target instanceof Element
            ? event.target.closest<HTMLAnchorElement>("a[href]")
            : null
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          !link ||
          !event.currentTarget.contains(link) ||
          (link.target && link.target !== "_self") ||
          link.hasAttribute("download")
        )
          return

        // Brand's anchor items do not invoke the overlay's close-and-focus handler.
        handler?.(String(build.number))
      }}
    >
      <span className="review-shell__build-option-content">
        <span className="review-shell__build-option-label">{build.label}</span>
        {build.stateLabel ? (
          <span className="review-shell__build-status">{build.stateLabel}</span>
        ) : null}
      </span>
    </ActionMenu.Item>
  )
}
