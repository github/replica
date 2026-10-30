import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react"

import type { ControlsPanelPosition } from "../types"

export function usePanelPosition(
  position: ControlsPanelPosition | null,
  onChange: (position: ControlsPanelPosition) => void,
) {
  const boundsRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const handleRef = useRef<HTMLButtonElement>(null)
  const current = useRef({ position, onChange })
  const drag = useRef<{
    pointerId: number
    x: number
    y: number
    origin: ControlsPanelPosition
  } | null>(null)
  const [dragging, setDragging] = useState(false)

  useLayoutEffect(() => {
    current.current = { position, onChange }
  })

  const move = useCallback((next: ControlsPanelPosition) => {
    const bounds = boundsRef.current?.getBoundingClientRect()
    const panel = panelRef.current?.getBoundingClientRect()
    if (!bounds || !panel || !bounds.width || !bounds.height) return
    const constrained = {
      x: Math.max(0, Math.min(next.x, Math.max(0, bounds.width - panel.width))),
      y: Math.max(0, Math.min(next.y, Math.max(0, bounds.height - panel.height))),
    }
    if (
      current.current.position?.x === constrained.x &&
      current.current.position?.y === constrained.y
    )
      return
    current.current.onChange(constrained)
  }, [])

  useLayoutEffect(() => {
    const bounds = boundsRef.current
    const panel = panelRef.current
    if (!bounds || !panel) return
    function constrain() {
      const boundsRect = bounds?.getBoundingClientRect()
      const panelRect = panel?.getBoundingClientRect()
      if (!boundsRect || !panelRect || !boundsRect.width || !boundsRect.height) return
      const x = panelRect.left - boundsRect.left
      const y = panelRect.top - boundsRect.top
      if (
        x < 0 ||
        y < 0 ||
        x > Math.max(0, boundsRect.width - panelRect.width) ||
        y > Math.max(0, boundsRect.height - panelRect.height)
      )
        move({ x, y })
    }
    const observer = new ResizeObserver(constrain)
    observer.observe(bounds)
    observer.observe(panel)
    window.addEventListener("resize", constrain)
    constrain()
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", constrain)
    }
  }, [move])

  function finish(cancelled = false) {
    const active = drag.current
    drag.current = null
    setDragging(false)
    if (!active) return
    if (cancelled) move(active.origin)
    if (handleRef.current?.hasPointerCapture(active.pointerId))
      handleRef.current.releasePointerCapture(active.pointerId)
  }

  return {
    boundsRef,
    panelRef,
    handleRef,
    dragging,
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || drag.current) return
      const bounds = boundsRef.current?.getBoundingClientRect()
      const panel = panelRef.current?.getBoundingClientRect()
      if (!bounds || !panel) return
      drag.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        origin: { x: panel.left - bounds.left, y: panel.top - bounds.top },
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.focus()
      event.preventDefault()
      setDragging(true)
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const active = drag.current
      if (!active || active.pointerId !== event.pointerId) return
      move({
        x: active.origin.x + event.clientX - active.x,
        y: active.origin.y + event.clientY - active.y,
      })
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      if (drag.current?.pointerId === event.pointerId) finish()
    },
    onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => {
      if (drag.current?.pointerId === event.pointerId) finish(true)
    },
    onLostPointerCapture: () => {
      if (drag.current) finish()
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Escape" && drag.current) {
        event.preventDefault()
        finish(true)
        return
      }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return
      const bounds = boundsRef.current?.getBoundingClientRect()
      const panel = panelRef.current?.getBoundingClientRect()
      if (!bounds || !panel) return
      event.preventDefault()
      const step = event.shiftKey ? 1 : 10
      move({
        x:
          panel.left -
          bounds.left +
          (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
        y:
          panel.top -
          bounds.top +
          (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0),
      })
    },
  }
}
