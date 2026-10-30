import { useCallback, useEffect, useRef, useState } from "react"

import { isWithinHoverCorridor } from "@utils/is-within-hover-corridor"

export function useHoverPreview(enabled: boolean) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLLIElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const timer = useRef<number | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)

  const cancelClose = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }, [])

  const close = useCallback(() => {
    cancelClose()
    origin.current = null
    setOpen(false)
  }, [cancelClose])

  const enter = useCallback(() => {
    cancelClose()
    origin.current = null
    if (enabled) setOpen(true)
  }, [cancelClose, enabled])

  const scheduleClose = useCallback(
    (reset = false) => {
      if (timer.current !== null && !reset) return
      cancelClose()
      timer.current = window.setTimeout(close, 300)
    },
    [cancelClose, close],
  )

  function leave(point: { x: number; y: number }) {
    if (!enabled || !open) return
    if (triggerRef.current?.contains(document.activeElement)) return

    origin.current = point
    scheduleClose()
  }

  useEffect(() => {
    if (!open || !enabled) return

    function move(event: MouseEvent) {
      if (!origin.current || !panelRef.current) return

      const point = { x: event.clientX, y: event.clientY }
      const panel = panelRef.current.getBoundingClientRect()
      if (
        point.x >= panel.left &&
        point.x <= panel.right &&
        point.y >= panel.top &&
        point.y <= panel.bottom
      ) {
        enter()
      } else if (isWithinHoverCorridor(point, origin.current, panel)) {
        scheduleClose(true)
      } else {
        scheduleClose()
      }
    }

    document.addEventListener("mousemove", move)
    return () => {
      document.removeEventListener("mousemove", move)
      cancelClose()
    }
  }, [open, enabled, enter, scheduleClose, cancelClose])

  return { open: open && enabled, triggerRef, panelRef, enter, leave, close }
}
