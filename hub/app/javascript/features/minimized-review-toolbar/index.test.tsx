import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { reviewCommentsCopy } from "@utils/review-comment/en"

import { MinimizedReviewToolbar } from "."
import type { MinimizedReviewToolbarProps } from "./types"

const reviewControls: NonNullable<MinimizedReviewToolbarProps["reviewControls"]> = {
  bridgeReady: true,
  commentCount: 3,
  copy: reviewCommentsCopy,
  hasUnreadComments: true,
  selectionBlocked: false,
  selecting: false,
  sidebarToggleBlocked: false,
  sidebarOpen: false,
  onCancelSelection: vi.fn(),
  onStartAreaSelection: vi.fn(),
  onStartElementSelection: vi.fn(),
  onToggleSidebar: vi.fn(),
}
const props: MinimizedReviewToolbarProps = {
  reviewControls,
  maximizeLabel: "Maximize Hub UI",
  dragLabel: "Move review toolbar",
  onMaximize: vi.fn(),
}

let toolbarWidth = 220
let toolbarHeight = 40
const resizeObservers = new Map<Element, ResizeObserverCallback>()
const disconnect = vi.fn()

function renderToolbar(overrides: Partial<MinimizedReviewToolbarProps> = {}) {
  const toolbarProps = { ...props, ...overrides }
  const result = render(<MinimizedReviewToolbar {...toolbarProps} />)
  const toolbar = screen.getByRole("toolbar", {
    name: toolbarProps.reviewControls?.copy.heading ?? toolbarProps.maximizeLabel,
  })
  const handle = screen.getByRole("button", { name: props.dragLabel })
  let captured = false
  const setPointerCapture = vi.fn(() => {
    captured = true
  })
  const releasePointerCapture = vi.fn(() => {
    captured = false
  })
  Object.assign(handle, {
    setPointerCapture,
    releasePointerCapture,
    hasPointerCapture: () => captured,
  })
  return { ...result, toolbar, handle, setPointerCapture, releasePointerCapture }
}

beforeEach(() => {
  toolbarWidth = 220
  toolbarHeight = 40
  resizeObservers.clear()
  vi.stubGlobal("innerWidth", 800)
  vi.stubGlobal("innerHeight", 600)
  vi.stubGlobal("visualViewport", undefined)
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerId: number
      isPrimary: boolean
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init)
        this.pointerId = init.pointerId ?? 1
        this.isPrimary = init.isPrimary ?? true
      }
    },
  )
  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: ResizeObserverCallback
      target?: Element
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }
      observe(target: Element) {
        this.target = target
        resizeObservers.set(target, this.callback)
      }
      unobserve() {}
      disconnect() {
        if (this.target?.classList.contains("minimized-review-toolbar")) disconnect()
      }
    },
  )
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const toolbar = this.classList.contains("minimized-review-toolbar")
      ? this
      : this.closest<HTMLElement>(".minimized-review-toolbar")
    const x = Number.parseFloat(toolbar?.style.left ?? "") || 0
    const y = Number.parseFloat(toolbar?.style.top ?? "") || 0
    if (this === toolbar) return new DOMRect(x, y, toolbarWidth, toolbarHeight)
    if (this.classList.contains("review-comment-control__trigger")) {
      return new DOMRect(x + 44, y + 4, 32, 32)
    }
    if (this.getAttribute("role") === "menu") return new DOMRect(0, 0, 300, 88)
    return new DOMRect()
  })
})

describe("MinimizedReviewToolbar()", () => {
  it("keeps the same draggable handle and maximize action without any review controls for Browse", () => {
    toolbarWidth = 80
    const { toolbar, handle } = renderToolbar({ reviewControls: undefined })
    expect(within(toolbar).getAllByRole("button")).toHaveLength(2)
    expect(screen.queryByRole("button", { name: /comment/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(toolbar.querySelector(".review-shell__unread-badge")).toBeNull()
    expect(toolbar.querySelector(".minimized-review-toolbar__separator")).toBeNull()
    expect(toolbar).toHaveStyle({ left: "360px", top: "552px" })

    fireEvent.pointerDown(handle, { clientX: 370, clientY: 560 })
    fireEvent.pointerMove(handle, { clientX: 2000, clientY: -1000 })
    fireEvent.pointerUp(handle)
    expect(toolbar).toHaveStyle({ left: "712px", top: "8px" })
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true })
    expect(toolbar).toHaveStyle({ left: "672px", top: "8px" })
    fireEvent.click(screen.getByRole("button", { name: props.maximizeLabel }))
    expect(props.onMaximize).toHaveBeenCalledOnce()
  })

  it("starts at the bottom center using its measured dimensions", () => {
    const { toolbar, handle } = renderToolbar()

    expect(toolbar).toHaveStyle({ left: "290px", top: "552px" })
    expect(handle).toHaveAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight ArrowUp ArrowDown")
    expect(toolbar).not.toHaveAttribute("data-dragging")
  })

  it("captures pointer movement on the handle and releases it after dragging", () => {
    const { toolbar, handle, setPointerCapture, releasePointerCapture } = renderToolbar()
    const down = createEvent.pointerDown(handle, {
      pointerId: 7,
      clientX: 300,
      clientY: 560,
      button: 0,
      cancelable: true,
    })
    fireEvent(handle, down)

    expect(down.defaultPrevented).toBe(true)
    expect(handle).toHaveFocus()
    expect(setPointerCapture).toHaveBeenCalledWith(7)
    expect(toolbar).toHaveAttribute("data-dragging", "true")

    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 390, clientY: 440 })
    expect(toolbar).toHaveStyle({ left: "380px", top: "432px" })

    fireEvent.pointerMove(handle, { pointerId: 8, clientX: 0, clientY: 0 })
    expect(toolbar).toHaveStyle({ left: "380px", top: "432px" })

    fireEvent.pointerUp(handle, { pointerId: 7 })
    expect(releasePointerCapture).toHaveBeenCalledWith(7)
    expect(toolbar).not.toHaveAttribute("data-dragging")

    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 0, clientY: 0 })
    expect(toolbar).toHaveStyle({ left: "380px", top: "432px" })
  })

  it("clamps pointer movement against every viewport edge", () => {
    const { toolbar, handle } = renderToolbar()
    fireEvent.pointerDown(handle, { clientX: 300, clientY: 560 })
    fireEvent.pointerMove(handle, { clientX: -1000, clientY: -1000 })
    expect(toolbar).toHaveStyle({ left: "8px", top: "8px" })

    fireEvent.pointerMove(handle, { clientX: 2000, clientY: 2000 })
    expect(toolbar).toHaveStyle({ left: "572px", top: "552px" })
  })

  it("ignores secondary pointers, non-primary buttons and drags on review controls", () => {
    const { toolbar, handle, setPointerCapture } = renderToolbar()
    fireEvent.pointerDown(handle, { button: 2 })
    fireEvent.pointerDown(handle, { isPrimary: false })
    fireEvent.pointerDown(screen.getByRole("button", { name: "Comments, 3, Unread" }))
    fireEvent.pointerMove(toolbar, { clientX: 0, clientY: 0 })

    expect(setPointerCapture).not.toHaveBeenCalled()
    expect(toolbar).toHaveStyle({ left: "290px", top: "552px" })
  })

  it("uses arrow keys only on the drag handle, with larger Shift steps and clamping", () => {
    const { toolbar, handle } = renderToolbar()
    act(() => handle.focus())
    const arrow = createEvent.keyDown(handle, { key: "ArrowUp", cancelable: true })
    fireEvent(handle, arrow)
    expect(arrow.defaultPrevented).toBe(true)
    expect(toolbar).toHaveStyle({ left: "290px", top: "542px" })

    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true })
    expect(toolbar).toHaveStyle({ left: "250px", top: "542px" })

    for (let step = 0; step < 20; step++) {
      fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true })
      fireEvent.keyDown(handle, { key: "ArrowDown", shiftKey: true })
    }
    expect(toolbar).toHaveStyle({ left: "572px", top: "552px" })
    expect(handle).toHaveFocus()

    fireEvent.keyDown(screen.getByRole("button", { name: props.maximizeLabel }), {
      key: "ArrowLeft",
    })
    expect(toolbar).toHaveStyle({ left: "572px", top: "552px" })
  })

  it("restores the drag origin on Escape or pointer cancellation", () => {
    const { toolbar, handle, releasePointerCapture } = renderToolbar()
    fireEvent.pointerDown(handle, { pointerId: 4, clientX: 300, clientY: 560 })
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 100, clientY: 100 })
    fireEvent.keyDown(handle, { key: "Escape" })

    expect(toolbar).toHaveStyle({ left: "290px", top: "552px" })
    expect(releasePointerCapture).toHaveBeenCalledWith(4)
    expect(toolbar).not.toHaveAttribute("data-dragging")

    fireEvent.pointerDown(handle, { pointerId: 5, clientX: 300, clientY: 560 })
    fireEvent.pointerMove(handle, { pointerId: 5, clientX: 100, clientY: 100 })
    fireEvent.pointerCancel(handle, { pointerId: 5 })
    expect(toolbar).toHaveStyle({ left: "290px", top: "552px" })
    expect(toolbar).not.toHaveAttribute("data-dragging")
  })

  it("ends dragging if capture is lost", () => {
    const { toolbar, handle } = renderToolbar()
    fireEvent.pointerDown(handle, { pointerId: 2, clientX: 300, clientY: 560 })
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 100, clientY: 100 })
    fireEvent.lostPointerCapture(handle, { pointerId: 2 })
    expect(toolbar).not.toHaveAttribute("data-dragging")

    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 200, clientY: 200 })
    expect(toolbar).toHaveStyle({ left: "90px", top: "92px" })
  })

  it("reclamps on viewport and toolbar resize without assuming a control width", () => {
    const { toolbar, unmount } = renderToolbar()
    vi.stubGlobal("innerWidth", 400)
    vi.stubGlobal("innerHeight", 240)
    fireEvent(window, new Event("resize"))
    expect(toolbar).toHaveStyle({ left: "172px", top: "192px" })

    toolbarWidth = 300
    toolbarHeight = 48
    act(() => resizeObservers.get(toolbar)!([], {} as ResizeObserver))
    expect(toolbar).toHaveStyle({ left: "92px", top: "184px" })

    unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it("keeps the toolbar inside the visible viewport when its offsets change", () => {
    const visible = Object.assign(new EventTarget(), {
      offsetLeft: 100,
      offsetTop: 50,
      width: 400,
      height: 300,
    })
    vi.stubGlobal("visualViewport", visible)
    const { toolbar, handle } = renderToolbar()
    expect(toolbar).toHaveStyle({ left: "190px", top: "302px" })

    fireEvent.pointerDown(handle, { clientX: 200, clientY: 310 })
    fireEvent.pointerMove(handle, { clientX: 0, clientY: 0 })
    expect(toolbar).toHaveStyle({ left: "108px", top: "58px" })

    visible.offsetTop = 150
    act(() => {
      visible.dispatchEvent(new Event("scroll"))
    })
    expect(toolbar).toHaveStyle({ left: "108px", top: "158px" })
  })

  it("preserves count, unread state, sidebar and maximize actions", () => {
    renderToolbar()
    const comments = screen.getByRole("button", { name: "Comments, 3, Unread" })
    expect(comments).toHaveAttribute("aria-expanded", "false")
    expect(comments).toHaveAttribute("aria-keyshortcuts", "Shift+C")
    expect(comments.querySelector(".review-shell__unread-badge")).toBeInTheDocument()

    fireEvent.click(comments)
    fireEvent.click(screen.getByRole("button", { name: props.maximizeLabel }))
    expect(reviewControls.onToggleSidebar).toHaveBeenCalledOnce()
    expect(props.onMaximize).toHaveBeenCalledOnce()
  })

  it("opens a viewport-fitted menu above the bottom toolbar and runs both review actions", async () => {
    const { toolbar } = renderToolbar()
    fireEvent.click(screen.getByRole("button", { name: reviewCommentsCopy.commentMenuLabel }))
    await waitFor(() => {
      expect(toolbar.style.getPropertyValue("--minimized-review-menu-top")).toBe("464px")
      expect(toolbar.style.getPropertyValue("--minimized-review-menu-left")).toBe("334px")
    })
    fireEvent.click(
      screen.getByRole("menuitem", { name: reviewCommentsCopy.commentOnElementLabel }),
    )
    expect(reviewControls.onStartElementSelection).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole("button", { name: reviewCommentsCopy.commentMenuLabel }))
    fireEvent.click(screen.getByRole("menuitem", { name: reviewCommentsCopy.highlightRegionLabel }))
    expect(reviewControls.onStartAreaSelection).toHaveBeenCalledOnce()
  })

  it("positions the menu below a top-edge toolbar and clamps its measured width", async () => {
    const { toolbar, handle } = renderToolbar()
    fireEvent.pointerDown(handle, { clientX: 300, clientY: 560 })
    fireEvent.pointerMove(handle, { clientX: 2000, clientY: -1000 })
    fireEvent.pointerUp(handle)
    fireEvent.click(screen.getByRole("button", { name: reviewCommentsCopy.commentMenuLabel }))

    await waitFor(() => {
      expect(toolbar.style.getPropertyValue("--minimized-review-menu-top")).toBe("48px")
      expect(toolbar.style.getPropertyValue("--minimized-review-menu-left")).toBe("492px")
    })
  })

  it("preserves unavailable, blocked and cancel-selection states", () => {
    const { rerender } = renderToolbar({
      reviewControls: { ...reviewControls, bridgeReady: false, sidebarToggleBlocked: true },
    })
    expect(screen.getByRole("button", { name: reviewCommentsCopy.commentMenuLabel })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Comments, 3, Unread" })).toBeDisabled()

    rerender(
      <MinimizedReviewToolbar
        {...props}
        reviewControls={{ ...reviewControls, selectionBlocked: true }}
      />,
    )
    expect(screen.getByRole("button", { name: reviewCommentsCopy.commentMenuLabel })).toBeDisabled()

    rerender(
      <MinimizedReviewToolbar {...props} reviewControls={{ ...reviewControls, selecting: true }} />,
    )
    const cancel = screen.getByRole("button", { name: reviewCommentsCopy.cancelSelectionLabel })
    expect(cancel).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(cancel)
    expect(reviewControls.onCancelSelection).toHaveBeenCalledOnce()
  })
})
