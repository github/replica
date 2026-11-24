import { ChatIcon, CommentIcon, EyeIcon, PaintbrushIcon, XIcon } from "@primer/octicons-react"
import { ActionMenu, Tooltip } from "@primer/react-brand/esm"
import { useId } from "react"
import { HubIconButton } from "@components/hub-icon-button"
import { HubVisuallyHidden } from "@components/hub-visually-hidden"
import { ShortcutTooltip } from "@components/shortcut-tooltip"

import type { ReviewCommentControlProps } from "./types"

import "./styles.css"

function MenuLabel({ children, shortcut }: { children: string; shortcut?: string[] }) {
  if (!shortcut) return children
  return (
    <span className="review-comment-control__menu-label">
      {children}
      <span aria-hidden="true" className="review-comment-control__shortcut">
        {shortcut.map((key) => (
          <kbd key={key} className="review-comment-control__key">
            {key}
          </kbd>
        ))}
      </span>
    </span>
  )
}

/** Starts or cancels selecting a target for a review comment. */
export function ReviewCommentControl({
  bridgeReady,
  copy,
  selectionBlocked,
  selecting,
  unifiedSelection = false,
  visibilityAction,
  onCancelSelection,
  onStartAreaSelection,
  onStartElementSelection,
}: ReviewCommentControlProps) {
  const descriptionId = useId()
  const unavailable = !bridgeReady || selectionBlocked
  const actionDescription = !bridgeReady
    ? copy.bridgeUnavailableLabel
    : selectionBlocked
      ? copy.selectionBlockedLabel
      : copy.commentMenuLabel

  if (selecting) {
    const cancel = (
      <HubIconButton
        icon={XIcon}
        aria-label={copy.cancelSelectionLabel}
        description={unifiedSelection ? undefined : copy.cancelSelectionLabel}
        aria-keyshortcuts={unifiedSelection ? "C" : undefined}
        aria-pressed
        size="small"
        variant="default"
        className="review-comment-control__trigger"
        onClick={onCancelSelection}
      />
    )
    return unifiedSelection ? (
      <ShortcutTooltip text={copy.cancelSelectionLabel} shortcut="C" type="description">
        {cancel}
      </ShortcutTooltip>
    ) : (
      cancel
    )
  }

  const menu = (
    <ActionMenu selectionVariant="none" size="small" menuAlignment="start" disabled={unavailable}>
      <ActionMenu.Button
        className="review-comment-control__trigger"
        variant="secondary"
        aria-label={copy.commentMenuLabel}
        aria-describedby={descriptionId}
        aria-keyshortcuts={unifiedSelection ? "C" : undefined}
        leadingVisual={<ChatIcon size={16} />}
        onClick={(event) => {
          const button = event.currentTarget
          const scrollport = button
            .closest(".repository-workspace__content")
            ?.getBoundingClientRect()
          const bottom = Math.min(window.innerHeight, scrollport?.bottom ?? window.innerHeight)
          const height = Math.max(0, bottom - button.getBoundingClientRect().bottom - 8)
          button
            .closest<HTMLElement>('[data-testid="ActionMenu"]')
            ?.style.setProperty("--review-comment-control-menu-height", `${height}px`)
        }}
      >
        {""}
      </ActionMenu.Button>
      <ActionMenu.Overlay aria-label={copy.commentMenuLabel}>
        <ActionMenu.Item
          className="review-comment-control__menu-item"
          value="element"
          leadingVisual={<CommentIcon size={16} />}
          aria-keyshortcuts="C"
          onClick={onStartElementSelection}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              onStartElementSelection()
            }
          }}
        >
          <MenuLabel shortcut={unifiedSelection ? ["C"] : undefined}>
            {unifiedSelection ? copy.commentMenuLabel : copy.commentOnElementLabel}
          </MenuLabel>
        </ActionMenu.Item>
        {!unifiedSelection ? (
          <ActionMenu.Item
            className="review-comment-control__menu-item"
            value="area"
            leadingVisual={<PaintbrushIcon size={16} />}
            aria-keyshortcuts="H"
            onClick={onStartAreaSelection}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onStartAreaSelection()
              }
            }}
          >
            {copy.highlightRegionLabel}
          </ActionMenu.Item>
        ) : null}
        {visibilityAction ? (
          <ActionMenu.Item
            className="review-comment-control__menu-item"
            value="visibility"
            leadingVisual={<EyeIcon size={16} />}
            aria-keyshortcuts="Shift+C"
            onClick={visibilityAction.onToggle}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                visibilityAction.onToggle()
              }
            }}
          >
            <MenuLabel shortcut={["Shift", "C"]}>{visibilityAction.label}</MenuLabel>
          </ActionMenu.Item>
        ) : null}
      </ActionMenu.Overlay>
    </ActionMenu>
  )

  if (unavailable) {
    return (
      <div title={actionDescription}>
        {menu}
        <HubVisuallyHidden id={descriptionId}>{actionDescription}</HubVisuallyHidden>
      </div>
    )
  }

  return unifiedSelection ? (
    <ShortcutTooltip id={descriptionId} text={actionDescription} shortcut="C" type="description">
      <div>{menu}</div>
    </ShortcutTooltip>
  ) : (
    <Tooltip id={descriptionId} text={actionDescription} type="description">
      <div>{menu}</div>
    </Tooltip>
  )
}
