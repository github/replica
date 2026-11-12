import { ChatIcon, CommentIcon, PaintbrushIcon, XIcon } from "@primer/octicons-react"
import { ActionMenu, Tooltip } from "@primer/react-brand"
import { useId } from "react"
import { HubIconButton } from "@components/hub-icon-button"
import { HubVisuallyHidden } from "@components/hub-visually-hidden"

import type { ReviewCommentControlProps } from "./types"

import "./styles.css"

/** Starts or cancels selecting a target for a review comment. */
export function ReviewCommentControl({
  bridgeReady,
  copy,
  selectionBlocked,
  selecting,
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
    return (
      <HubIconButton
        icon={XIcon}
        aria-label={copy.cancelSelectionLabel}
        description={copy.cancelSelectionLabel}
        aria-pressed
        size="small"
        variant="default"
        className="review-comment-control__trigger"
        onClick={onCancelSelection}
      />
    )
  }

  const menu = (
    <ActionMenu selectionVariant="none" size="small" menuAlignment="start" disabled={unavailable}>
      <ActionMenu.Button
        className="review-comment-control__trigger"
        variant="secondary"
        aria-label={copy.commentMenuLabel}
        aria-describedby={descriptionId}
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
          {copy.commentOnElementLabel}
        </ActionMenu.Item>
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

  return (
    <Tooltip id={descriptionId} text={actionDescription} type="description">
      <div>{menu}</div>
    </Tooltip>
  )
}
