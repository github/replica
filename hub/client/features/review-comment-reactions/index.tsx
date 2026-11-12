import { SmileyIcon } from "@primer/octicons-react"
import { ActionMenu, Button, Tooltip } from "@primer/react-brand"
import { useId, useRef, useState } from "react"
import type { MouseEvent } from "react"

import type { ReviewReactionContent } from "@utils/review-comment/types"
import { REACTION_CONTENT_SCHEMA } from "@utils/review-comment/schemas"
import { reviewReactionEmoji } from "@utils/review-reaction-emoji"
import { HubCounter } from "@components/hub-counter"
import { HubVisuallyHidden } from "@components/hub-visually-hidden"

import type { ReviewCommentReactionsProps } from "./types"

import "./styles.css"

const REACTION_OPTIONS = REACTION_CONTENT_SCHEMA.options.map((content) => ({
  content,
  emoji: reviewReactionEmoji(content),
}))

function reactionPoint(element: HTMLElement, clientX = 0, clientY = 0) {
  if (clientX !== 0 || clientY !== 0) return { x: clientX, y: clientY }

  const bounds = element.getBoundingClientRect()
  return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
}

export function ReviewCommentReactions({
  comment,
  mutation,
  actionsDisabled,
  controlsHidden = false,
  copy,
  onAdd,
  onRemove,
  onBurst,
}: ReviewCommentReactionsProps) {
  const tooltipId = useId()
  const [failed, setFailed] = useState(false)
  const [tooltipSuppressed, setTooltipSuppressed] = useState(false)
  const pendingRef = useRef(false)
  const [optimistic, setOptimistic] = useState<{
    content: ReviewReactionContent
    viewerHasReacted: boolean
  } | null>(null)
  const [menuSide, setMenuSide] = useState<"outside-bottom" | "outside-top">("outside-bottom")
  const changing =
    mutation !== null &&
    (mutation.kind === "add-reaction" || mutation.kind === "remove-reaction") &&
    mutation.commentId === comment.id
  const reactions = comment.reactions.flatMap((reaction) => {
    if (!optimistic || reaction.content !== optimistic.content) return [reaction]

    const count =
      reaction.count + Number(optimistic.viewerHasReacted) - Number(reaction.viewerHasReacted)
    return count > 0 ? [{ ...reaction, count, viewerHasReacted: optimistic.viewerHasReacted }] : []
  })
  if (
    optimistic?.viewerHasReacted &&
    !comment.reactions.some(({ content }) => content === optimistic.content)
  ) {
    reactions.push({ content: optimistic.content, count: 1, viewerHasReacted: true })
  }

  async function changeReaction(content: ReviewReactionContent, point: { x: number; y: number }) {
    if (actionsDisabled || mutation !== null || pendingRef.current) return

    const current = comment.reactions.find((reaction) => reaction.content === content)
    const removing = current?.viewerHasReacted ?? false
    pendingRef.current = true
    setFailed(false)
    setOptimistic({ content, viewerHasReacted: !removing })
    try {
      if (!removing) {
        const option = REACTION_OPTIONS.find((reaction) => reaction.content === content)
        if (option) onBurst(option.emoji, point.x, point.y)
      }
      const changed = removing ? await onRemove(content) : await onAdd(content)
      setFailed(!changed)
    } catch {
      setFailed(true)
    } finally {
      pendingRef.current = false
      setOptimistic(null)
    }
  }

  function selectReaction(content: ReviewReactionContent, event: MouseEvent<HTMLElement>) {
    void changeReaction(content, reactionPoint(event.currentTarget, event.clientX, event.clientY))
  }

  const menu = (
    <ActionMenu
      selectionVariant="none"
      size="small"
      menuAlignment="end"
      menuSide={menuSide}
      disabled={actionsDisabled}
    >
      <ActionMenu.Button
        className="review-comment-reactions__menu-trigger"
        variant="subtle"
        aria-label={copy.addReactionLabel}
        aria-describedby={tooltipId}
        aria-busy={changing || optimistic !== null}
        leadingVisual={<SmileyIcon size={16} />}
        onClick={(event) => {
          setTooltipSuppressed(true)
          const bounds = event.currentTarget.getBoundingClientRect()
          const shell = event.currentTarget.closest(".review-shell")?.getBoundingClientRect()
          const spaceBelow = Math.min(window.innerHeight, shell?.bottom ?? Infinity) - bounds.bottom
          const spaceAbove = bounds.top - Math.max(0, shell?.top ?? 0)
          const panelHeight = REACTION_OPTIONS.length * 36 + 16
          setMenuSide(
            spaceBelow < panelHeight && spaceAbove > spaceBelow ? "outside-top" : "outside-bottom",
          )
        }}
      >
        {""}
      </ActionMenu.Button>
      <ActionMenu.Overlay aria-label={copy.addReactionLabel}>
        {REACTION_OPTIONS.map((option) => (
          <ActionMenu.Item
            key={option.content}
            value={option.content}
            leadingVisual={
              <span className="review-comment-reactions__picker-emoji">{option.emoji}</span>
            }
            onClick={(event) => selectReaction(option.content, event)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                void changeReaction(option.content, reactionPoint(event.currentTarget))
              }
            }}
          >
            {copy.reactionLabels[option.content]}
          </ActionMenu.Item>
        ))}
      </ActionMenu.Overlay>
    </ActionMenu>
  )

  if (controlsHidden && !failed) return null

  return (
    <div className="review-comment-reactions__layout">
      {controlsHidden ? null : (
        <div className="review-comment-reactions">
          {reactions.map((reaction) => {
            const option = REACTION_OPTIONS.find(({ content }) => content === reaction.content)
            if (!option) return null

            const labelTemplate =
              reaction.count === 1 ? copy.reactionCountOneLabel : copy.reactionCountOtherLabel
            const label = labelTemplate
              .replace("%{reaction}", copy.reactionLabels[reaction.content])
              .replace("%{count}", reaction.count.toString())

            return (
              <Button
                key={reaction.content}
                size="small"
                aria-label={label}
                title={label}
                aria-pressed={reaction.viewerHasReacted}
                disabled={actionsDisabled}
                aria-busy={
                  optimistic?.content === reaction.content ||
                  (changing && "content" in mutation && mutation.content === reaction.content)
                }
                className={
                  reaction.viewerHasReacted ? "review-comment-reaction--selected" : undefined
                }
                onClick={(event: MouseEvent<HTMLButtonElement>) =>
                  selectReaction(reaction.content, event)
                }
              >
                <span aria-hidden="true">{option.emoji}</span>
                <HubCounter aria-hidden="true">{reaction.count}</HubCounter>
              </Button>
            )
          })}

          {actionsDisabled ? (
            <div title={copy.addReactionLabel}>
              {menu}
              <HubVisuallyHidden id={tooltipId}>{copy.addReactionLabel}</HubVisuallyHidden>
            </div>
          ) : (
            <Tooltip
              id={tooltipId}
              text={copy.addReactionLabel}
              type="description"
              className={`review-comment-reactions__tooltip${tooltipSuppressed ? " review-comment-reactions__tooltip--suppressed" : ""}`}
            >
              <div
                onMouseEnter={(event) => {
                  if (!event.currentTarget.querySelector('[aria-expanded="true"]')) {
                    setTooltipSuppressed(false)
                  }
                }}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setTooltipSuppressed(false)
                  }
                }}
              >
                {menu}
              </div>
            </Tooltip>
          )}
        </div>
      )}

      {failed ? (
        <span role="alert" className="review-comment-reactions__error">
          {copy.reactionErrorLabel}
        </span>
      ) : null}
    </div>
  )
}
