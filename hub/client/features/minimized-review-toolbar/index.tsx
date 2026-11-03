import { GrabberIcon, ScreenFullIcon } from "@primer/octicons-react"
import { useCallback, useLayoutEffect, useRef, useState } from "react"
import type { KeyboardEvent, PointerEvent } from "react"

import { HubIconButton } from "@components/hub-icon-button"
import { PrototypeReviewControls } from "@features/prototype-review-controls"

import type { MinimizedReviewToolbarProps } from "./types"

import "./styles.css"

type Position = { x: number; y: number }
type Drag = {
  pointerId: number
  start: Position
  origin: Position
  handle: HTMLButtonElement
}

function viewport() {
  const visible = window.visualViewport
  return {
    left: (visible?.offsetLeft ?? 0) + 8,
    top: (visible?.offsetTop ?? 0) + 8,
    right: (visible?.offsetLeft ?? 0) + (visible?.width ?? window.innerWidth) - 8,
    bottom: (visible?.offsetTop ?? 0) + (visible?.height ?? window.innerHeight) - 8,
  }
}

export function MinimizedReviewToolbar({
  reviewControls,
  maximizeLabel,
  dragLabel,
  onMaximize,
  controlsSlotRef,
}: MinimizedReviewToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const positionRef = useRef<Position | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [dragging, setDragging] = useState(false)

  const positionMenu = useCallback(() => {
    const toolbar = toolbarRef.current
    const menu = toolbar?.querySelector<HTMLElement>('[role="menu"]')
    const trigger = toolbar?.querySelector<HTMLElement>(
      '.review-comment-control__trigger[aria-expanded="true"]',
    )
    if (!toolbar || !menu || !trigger) return

    const visible = viewport()
    const bounds = trigger.getBoundingClientRect()
    const above = bounds.top - visible.top - 4
    const below = visible.bottom - bounds.bottom - 4
    const opensAbove = above > below
    toolbar.style.setProperty(
      "--minimized-review-menu-height",
      `${Math.max(0, opensAbove ? above : below)}px`,
    )
    const menuBounds = menu.getBoundingClientRect()
    toolbar.style.setProperty(
      "--minimized-review-menu-left",
      `${Math.max(visible.left, Math.min(bounds.left, visible.right - menuBounds.width))}px`,
    )
    toolbar.style.setProperty(
      "--minimized-review-menu-top",
      `${opensAbove ? bounds.top - menuBounds.height - 4 : bounds.bottom + 4}px`,
    )
  }, [])

  const move = useCallback(
    (position: Position) => {
      const toolbar = toolbarRef.current
      if (!toolbar) return

      const bounds = toolbar.getBoundingClientRect()
      const visible = viewport()
      const next = {
        x: Math.max(visible.left, Math.min(position.x, visible.right - bounds.width)),
        y: Math.max(visible.top, Math.min(position.y, visible.bottom - bounds.height)),
      }
      positionRef.current = next
      toolbar.style.left = `${next.x}px`
      toolbar.style.top = `${next.y}px`
      toolbar.style.bottom = "auto"
      toolbar.style.transform = "none"
      positionMenu()
    },
    [positionMenu],
  )

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar) return

    function reposition() {
      const bounds = toolbar!.getBoundingClientRect()
      const visible = viewport()
      move(
        positionRef.current ?? {
          x: (visible.left + visible.right - bounds.width) / 2,
          y: visible.bottom - bounds.height,
        },
      )
    }

    reposition()
    const resize = new ResizeObserver(reposition)
    resize.observe(toolbar)
    const menu = new MutationObserver(positionMenu)
    menu.observe(toolbar, { childList: true, subtree: true })
    window.addEventListener("resize", reposition)
    window.visualViewport?.addEventListener("resize", reposition)
    window.visualViewport?.addEventListener("scroll", reposition)

    return () => {
      resize.disconnect()
      menu.disconnect()
      window.removeEventListener("resize", reposition)
      window.visualViewport?.removeEventListener("resize", reposition)
      window.visualViewport?.removeEventListener("scroll", reposition)
    }
  }, [move, positionMenu])

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary || dragRef.current || !positionRef.current) return

    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: positionRef.current,
      handle: event.currentTarget,
    }
    setDragging(true)
  }

  function drag(event: PointerEvent<HTMLButtonElement>) {
    const active = dragRef.current
    if (!active || active.pointerId !== event.pointerId) return

    move({
      x: active.origin.x + event.clientX - active.start.x,
      y: active.origin.y + event.clientY - active.start.y,
    })
  }

  function finishDrag(cancel = false) {
    const active = dragRef.current
    if (!active) return

    dragRef.current = null
    if (cancel) move(active.origin)
    if (active.handle.hasPointerCapture(active.pointerId)) {
      active.handle.releasePointerCapture(active.pointerId)
    }
    setDragging(false)
  }

  function moveWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && dragRef.current) {
      event.preventDefault()
      event.stopPropagation()
      finishDrag(true)
      return
    }
    if (!positionRef.current || dragRef.current) return

    const step = event.shiftKey ? 40 : 10
    const offset = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }[event.key]
    if (!offset) return

    event.preventDefault()
    event.stopPropagation()
    move({
      x: positionRef.current.x + offset.x,
      y: positionRef.current.y + offset.y,
    })
  }

  return (
    <div
      ref={toolbarRef}
      className="minimized-review-toolbar"
      role="toolbar"
      aria-label={reviewControls?.copy.heading ?? maximizeLabel}
      data-dragging={dragging || undefined}
    >
      <HubIconButton
        icon={GrabberIcon}
        variant="invisible"
        size="small"
        className="minimized-review-toolbar__drag"
        aria-label={dragLabel}
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
        title={dragLabel}
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) finishDrag()
        }}
        onPointerCancel={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) finishDrag(true)
        }}
        onLostPointerCapture={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) finishDrag()
        }}
        onKeyDown={moveWithKeyboard}
      />

      {reviewControls ? (
        <>
          <PrototypeReviewControls {...reviewControls} />

          <span className="minimized-review-toolbar__separator" aria-hidden="true" />
        </>
      ) : null}

      {controlsSlotRef ? <span ref={controlsSlotRef} /> : null}

      <HubIconButton
        icon={ScreenFullIcon}
        variant="invisible"
        size="small"
        aria-label={maximizeLabel}
        description={maximizeLabel}
        onClick={onMaximize}
      />
    </div>
  )
}
