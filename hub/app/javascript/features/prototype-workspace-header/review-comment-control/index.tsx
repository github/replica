import { ChatIcon, CommentIcon, EyeIcon, XIcon } from "@primer/octicons-react"
import { ActionMenu } from "@primer/react-brand/esm"
import { useId } from "react"
import { HubIconButton } from "@components/hub-icon-button"
import { HubVisuallyHidden } from "@components/hub-visually-hidden"
import { ShortcutTooltip } from "@components/shortcut-tooltip"

import type { ReviewCommentControlProps } from "./types"

import "./styles.css"

function MenuLabel({ children, shortcut }: { children: string; shortcut: string[] }) {
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
  canCreateComment = true,
  copy,
  selectionBlocked,
  selecting,
  visibilityAction,
  onCancelSelection,
  onStartSelection,
}: ReviewCommentControlProps) {
  const descriptionId = useId()
  const unavailable = !bridgeReady || selectionBlocked || (!canCreateComment && !visibilityAction)
  const actionDescription = !bridgeReady
    ? copy.bridgeUnavailableLabel
    : selectionBlocked
      ? copy.selectionBlockedLabel
      : copy.commentMenuLabel

  if (selecting) {
    return (
      <ShortcutTooltip text={copy.cancelSelectionLabel} shortcut="C" type="description">
        <HubIconButton
          icon={XIcon}
          aria-label={copy.cancelSelectionLabel}
          aria-keyshortcuts="C"
          aria-pressed
          size="small"
          variant="default"
          className="review-comment-control__trigger"
          onClick={onCancelSelection}
        />
      </ShortcutTooltip>
    )
  }

  const menu = (
    <ActionMenu selectionVariant="none" size="small" menuAlignment="start" disabled={unavailable}>
      <ActionMenu.Button
        className="review-comment-control__trigger"
        variant="secondary"
        aria-label={copy.commentMenuLabel}
        aria-describedby={descriptionId}
        aria-keyshortcuts="C"
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
          value="comment"
          leadingVisual={<CommentIcon size={16} />}
          aria-keyshortcuts="C"
          disabled={!canCreateComment}
          onClick={onStartSelection}
          onKeyDown={(event) => {
            if (canCreateComment && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault()
              onStartSelection()
            }
          }}
        >
          <MenuLabel shortcut={["C"]}>{copy.commentMenuLabel}</MenuLabel>
        </ActionMenu.Item>
        {visibilityAction ? (
          <ActionMenu.Item
            className="review-comment-control__menu-item"
            value="visibility"
            leadingVisual={<EyeIcon size={16} />}
            onClick={visibilityAction.onToggle}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                visibilityAction.onToggle()
              }
            }}
          >
            {visibilityAction.label}
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

  return (
    <ShortcutTooltip id={descriptionId} text={actionDescription} shortcut="C" type="description">
      <div>{menu}</div>
    </ShortcutTooltip>
  )
}
