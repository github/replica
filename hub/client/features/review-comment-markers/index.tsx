import { Fragment, useEffect, useLayoutEffect, useRef } from "react"
import { Tooltip } from "@primer/react-brand"

import { ReviewParticipantStack } from "@features/review-participant-stack"
import { getAreaAnchorGeometry } from "@utils/get-area-anchor-geometry"
import type { ReviewCommentMarkersProps } from "./types"

import "./styles.css"

export function ReviewCommentMarkers({
  threads,
  resolutions,
  selectedThreadId,
  selectionBlocked,
  focusSelectedMarker = true,
  showAreaHighlightsOnlyWhenSelected = false,
  copy,
  onSelect,
}: ReviewCommentMarkersProps) {
  const anchorInset = 16
  const layerRef = useRef<HTMLDivElement>(null)
  const markerRefs = useRef(new Map<number, HTMLButtonElement>())
  const selectedStatus =
    selectedThreadId === null ? undefined : resolutions.get(selectedThreadId)?.status

  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!layer) return

    function positionMarkers() {
      const layerWidth = layer?.clientWidth ?? 0
      if (!layerWidth) return

      for (const marker of markerRefs.current.values()) {
        const anchorX = Number.parseFloat(marker.style.left)
        const markerWidth = marker.offsetWidth
        if (!Number.isFinite(anchorX) || !markerWidth) continue

        const markerLeft = anchorX - anchorInset
        const offset = Math.max(0, Math.min(markerLeft, layerWidth - markerWidth)) - markerLeft
        marker.style.setProperty("--review-marker-offset-x", `${offset}px`)
      }
    }

    positionMarkers()
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(positionMarkers)
    observer?.observe(layer)
    for (const marker of markerRefs.current.values()) observer?.observe(marker)
    window.addEventListener("resize", positionMarkers)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", positionMarkers)
    }
  }, [resolutions, threads])

  useEffect(() => {
    if (
      !focusSelectedMarker ||
      selectedThreadId === null ||
      (selectedStatus !== "resolved" && selectedStatus !== "moved")
    ) {
      return
    }

    markerRefs.current.get(selectedThreadId)?.focus({ preventScroll: true })
  }, [focusSelectedMarker, selectedStatus, selectedThreadId])

  return (
    <div ref={layerRef} className="review-comment-markers" role="group" aria-label={copy.heading}>
      {threads.map((thread) => {
        const { root } = thread
        const resolution = resolutions.get(root.id)
        if (!resolution || (resolution.status !== "resolved" && resolution.status !== "moved")) {
          return null
        }

        const hasReplies = thread.replies.length > 0
        const label = (
          thread.unread
            ? hasReplies
              ? copy.unreadMarkerWithRepliesLabel
              : copy.unreadMarkerLabel
            : hasReplies
              ? copy.markerWithRepliesLabel
              : copy.markerLabel
        )
          .replace("%{author}", `@${root.author.login}`)
          .replace("%{count}", (thread.replies.length + 1).toString())
        const areaGeometry =
          root.anchor.kind === "area" ? getAreaAnchorGeometry(root.anchor, resolution.rect) : null
        const hiddenParticipants = thread.participants.slice(3)
        const tooltipText =
          hiddenParticipants.length > 1
            ? hiddenParticipants.map(({ login }) => `@${login}`).join(", ")
            : label
        return (
          <Fragment key={root.id}>
            {areaGeometry &&
            (!showAreaHighlightsOnlyWhenSelected || selectedThreadId === root.id) ? (
              <svg className="review-comment-area" aria-hidden="true" width="100%" height="100%">
                <polyline
                  className={
                    selectedThreadId === root.id
                      ? "review-comment-area__path review-comment-area__path--selected"
                      : "review-comment-area__path"
                  }
                  points={areaGeometry.path.map((point) => `${point.x},${point.y}`).join(" ")}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            ) : null}

            <Tooltip
              text={tooltipText}
              type="description"
              ref={(element) => {
                if (element instanceof HTMLButtonElement) markerRefs.current.set(root.id, element)
                else markerRefs.current.delete(root.id)
              }}
            >
              <button
                type="button"
                data-review-thread-id={root.id}
                className={`review-comment-marker${
                  selectedThreadId === root.id ? " review-comment-marker--selected" : ""
                }${root.resolvedAt ? " review-comment-marker--resolved" : ""}${
                  thread.unread ? " review-comment-marker--unread" : ""
                }${
                  selectionBlocked && selectedThreadId !== root.id
                    ? " review-comment-marker--blocked"
                    : ""
                }`}
                style={{
                  left: areaGeometry?.point.x ?? resolution.point.x,
                  top: areaGeometry?.point.y ?? resolution.point.y,
                }}
                aria-label={label}
                disabled={selectionBlocked && selectedThreadId !== root.id}
                onClick={() => onSelect(thread)}
              >
                <ReviewParticipantStack participants={thread.participants} size="small" />
              </button>
            </Tooltip>
          </Fragment>
        )
      })}
    </div>
  )
}
