import { useCallback, useLayoutEffect, useRef, useState } from "react"

import { REVIEW_CARD_POSITION_MARGIN, REVIEW_CARD_POSITION_OFFSET } from "./constants"
import type { ReviewCardPosition, ReviewCardPositionOptions } from "./types"

/** Keeps a Hub-owned review card beside its anchor without clipping the card. */
export function useReviewCardPosition({
  anchorPoint,
  anchorRectangle,
  anchorSelector,
  layoutKey,
  preserveVerticalSide = false,
}: ReviewCardPositionOptions) {
  const cardRef = useRef<HTMLElement>(null)
  const verticalSideRef = useRef<{ x: number; y: number; side: "above" | "below" } | null>(null)
  const [position, setPosition] = useState<ReviewCardPosition>({
    left: anchorPoint.x + REVIEW_CARD_POSITION_OFFSET,
    top: anchorPoint.y + REVIEW_CARD_POSITION_OFFSET,
  })

  const updatePosition = useCallback(() => {
    const card = cardRef.current
    const container = card?.parentElement
    if (!card || !container) return

    const width = card.offsetWidth
    const height = card.offsetHeight
    const maxLeft = container.clientWidth - width - REVIEW_CARD_POSITION_MARGIN
    const maxTop = container.clientHeight - height - REVIEW_CARD_POSITION_MARGIN
    let left: number
    let top: number

    const marker = anchorSelector
      ? (container.querySelector(anchorSelector) ??
        container.parentElement?.querySelector(anchorSelector))
      : null
    const markerBounds = marker?.getBoundingClientRect()
    const containerBounds = container.getBoundingClientRect()
    const rectangle = markerBounds
      ? {
          x: markerBounds.left - containerBounds.left,
          y: markerBounds.top - containerBounds.top,
          // The circular first avatar, not the full participant stack, anchors the card.
          width: markerBounds.height,
          height: markerBounds.height,
        }
      : anchorRectangle

    if (rectangle) {
      const preferredRight = rectangle.x + rectangle.width + REVIEW_CARD_POSITION_OFFSET
      const preferredLeft = rectangle.x - REVIEW_CARD_POSITION_OFFSET - width
      const rightFits =
        preferredRight + width <= container.clientWidth - REVIEW_CARD_POSITION_MARGIN
      const leftFits = preferredLeft >= REVIEW_CARD_POSITION_MARGIN
      const spaceRight =
        container.clientWidth - REVIEW_CARD_POSITION_MARGIN - rectangle.x - rectangle.width
      const spaceLeft = rectangle.x - REVIEW_CARD_POSITION_MARGIN

      left = rightFits
        ? preferredRight
        : leftFits
          ? preferredLeft
          : spaceRight >= spaceLeft
            ? preferredRight
            : preferredLeft
      top = rectangle.y
    } else {
      const preferredLeft = anchorPoint.x + REVIEW_CARD_POSITION_OFFSET
      const preferredTop = anchorPoint.y + REVIEW_CARD_POSITION_OFFSET
      left =
        preferredLeft + width <= container.clientWidth - REVIEW_CARD_POSITION_MARGIN
          ? preferredLeft
          : anchorPoint.x - REVIEW_CARD_POSITION_OFFSET - width
      const previousSide = verticalSideRef.current
      const side =
        preserveVerticalSide &&
        previousSide?.x === anchorPoint.x &&
        previousSide.y === anchorPoint.y
          ? previousSide.side
          : preferredTop + height <= container.clientHeight - REVIEW_CARD_POSITION_MARGIN
            ? "below"
            : "above"
      if (preserveVerticalSide) {
        verticalSideRef.current = { x: anchorPoint.x, y: anchorPoint.y, side }
      }
      top = side === "below" ? preferredTop : anchorPoint.y - REVIEW_CARD_POSITION_OFFSET - height
    }

    const nextPosition = {
      left: Math.max(REVIEW_CARD_POSITION_MARGIN, Math.min(left, maxLeft)),
      top: Math.max(REVIEW_CARD_POSITION_MARGIN, Math.min(top, maxTop)),
    }
    setPosition((current) =>
      current.left === nextPosition.left && current.top === nextPosition.top
        ? current
        : nextPosition,
    )
  }, [anchorPoint, anchorRectangle, anchorSelector, preserveVerticalSide])

  useLayoutEffect(() => {
    updatePosition()

    const card = cardRef.current
    const container = card?.parentElement
    if (!card || !container || typeof ResizeObserver !== "function") return

    const observer = new ResizeObserver(updatePosition)
    observer.observe(card)
    observer.observe(container)
    const marker = anchorSelector
      ? (container.querySelector(anchorSelector) ??
        container.parentElement?.querySelector(anchorSelector))
      : null
    if (marker) observer.observe(marker)
    window.addEventListener("resize", updatePosition)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", updatePosition)
    }
  }, [anchorSelector, layoutKey, updatePosition])

  return { cardRef, position }
}
