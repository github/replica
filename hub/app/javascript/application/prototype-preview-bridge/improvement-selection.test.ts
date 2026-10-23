// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

import { REVIEW_ANCHOR_SCHEMA } from "@utils/review-anchor/schemas"
import { installBridge } from "./index"

const origin = "http://127.0.0.1:1234"
const installed = Symbol.for("replica.canvas.bridge.v1")

function pointerDown(
  target: EventTarget,
  { button = 0, isPrimary = true }: { button?: number; isPrimary?: boolean } = {},
) {
  const event = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button })
  Object.defineProperty(event, "isPrimary", { value: isPrimary })
  target.dispatchEvent(event)
  return event
}

function request(
  data: Record<string, unknown>,
  requestOrigin = origin,
  source: Window | null = window,
) {
  window.dispatchEvent(new MessageEvent("message", { origin: requestOrigin, source, data }))
}

function isSelectionMessage(message: unknown): message is Record<string, unknown> {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "replica:canvas:selected"
  )
}

function setup() {
  document.body.innerHTML = '<button id="save" aria-label="Save changes">Save changes</button>'
  const target = document.querySelector("button")!
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 30, 120, 40))
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => target),
  })
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: vi.fn(() => [target]),
  })
  const post = vi.spyOn(window, "postMessage")
  window.dispatchEvent(
    new MessageEvent("message", {
      origin,
      source: window,
      data: { type: "replica:canvas:select", nonce: "improvement", mode: "improvement" },
    }),
  )
  const surface = Array.from(
    document.querySelectorAll<HTMLElement>("[data-replica-canvas-bridge]"),
  ).find((element) => element.style.cursor === "crosshair")!
  surface.setPointerCapture = vi.fn()
  function pointer(type: string, x: number, y: number) {
    surface.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    )
  }
  function anchor() {
    const selected = post.mock.calls.map(([message]): unknown => message).find(isSelectionMessage)
    if (!selected) throw new Error("Expected a selection message")
    expect(selected.nonce).toBe("improvement")
    expect(selected).not.toHaveProperty("capturePending")
    expect(selected).not.toHaveProperty("capture")
    return REVIEW_ANCHOR_SCHEMA.parse(selected.anchor)
  }
  return { surface, target, pointer, anchor, post }
}

function withSelection(run: (selection: ReturnType<typeof setup>) => void) {
  installBridge(origin)
  try {
    run(setup())
  } finally {
    const bridgeWindow = window as Window & { [installed]?: () => void }
    bridgeWindow[installed]?.()
    document.body.innerHTML = ""
  }
}

describe("installBridge() improvement selection", () => {
  it("requests conversation dismissal for an ordinary primary preview pointer without blocking it", () => {
    const bridgeWindow = window as Window & { [installed]?: () => void }
    const target = document.createElement("button")
    const handled = vi.fn()
    target.addEventListener("pointerdown", handled)
    document.body.append(target)
    const post = vi.spyOn(window, "postMessage")
    installBridge(origin)
    request({ type: "replica:canvas:resolve", nonce: "current", anchors: [] })
    post.mockClear()
    try {
      const event = pointerDown(target)
      expect(event.defaultPrevented).toBe(false)
      expect(handled).toHaveBeenCalledOnce()
      expect(post).toHaveBeenCalledExactlyOnceWith(
        {
          type: "replica:canvas:conversation-dismiss-requested",
          nonce: "current",
          restoreFocus: false,
        },
        origin,
      )
    } finally {
      bridgeWindow[installed]?.()
      target.remove()
    }
  })

  it.each([
    ["before a resolve", "none"],
    ["while selection is active", "selection"],
    ["for a secondary pointer", "secondary"],
    ["for a non-primary pointer", "non-primary"],
  ])("does not request conversation dismissal %s", (_label, action) => {
    const bridgeWindow = window as Window & { [installed]?: () => void }
    const target = document.createElement("button")
    document.body.append(target)
    const post = vi.spyOn(window, "postMessage")
    installBridge(origin)
    if (action !== "none") {
      request({ type: "replica:canvas:resolve", nonce: "current", anchors: [] })
      if (action === "selection")
        request({ type: "replica:canvas:select", nonce: "selection", mode: "improvement" })
    }
    post.mockClear()
    try {
      pointerDown(target, {
        button: action === "secondary" ? 1 : 0,
        isPrimary: action !== "non-primary",
      })
      expect(post).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "replica:canvas:conversation-dismiss-requested" }),
        expect.anything(),
      )
    } finally {
      bridgeWindow[installed]?.()
      target.remove()
    }
  })

  it("clears dismissal and shortcut state when reinstalled", () => {
    const bridgeWindow = window as Window & { [installed]?: () => void }
    const target = document.createElement("button")
    document.body.append(target)
    const post = vi.spyOn(window, "postMessage")
    installBridge(origin)
    request({ type: "replica:canvas:resolve", nonce: "first", anchors: [] })
    request({
      type: "replica:canvas:request-ready",
      nonce: "shortcut",
      selectionShortcut: true,
    })
    installBridge(origin)
    post.mockClear()
    pointerDown(target)
    const shortcut = new KeyboardEvent("keydown", {
      key: "s",
      bubbles: true,
      cancelable: true,
    })
    target.dispatchEvent(shortcut)
    expect(shortcut.defaultPrevented).toBe(false)
    expect(post).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "replica:canvas:conversation-dismiss-requested",
      }),
      origin,
    )
    expect(post).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "replica:canvas:selection-toggle-requested",
      }),
      origin,
    )

    bridgeWindow[installed]?.()
    target.remove()
  })

  it("forwards S only while opted in and uses the current shortcut request nonce", () => {
    const post = vi.spyOn(window, "postMessage")
    const bridgeWindow = window as Window & { [installed]?: () => void }
    installBridge(origin)
    function press(key = "s") {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      return event
    }
    const optIn = {
      type: "replica:canvas:request-ready",
      nonce: "first-shortcut",
      selectionShortcut: true,
    }
    try {
      expect(press().defaultPrevented).toBe(false)
      request(optIn)
      post.mockClear()
      expect(press().defaultPrevented).toBe(true)
      expect(post).toHaveBeenCalledExactlyOnceWith(
        { type: "replica:canvas:selection-toggle-requested", nonce: "first-shortcut" },
        origin,
      )

      request({ ...optIn, nonce: "current-shortcut" })
      request({ ...optIn, selectionShortcut: false })
      post.mockClear()
      expect(press("S").defaultPrevented).toBe(true)
      expect(post).toHaveBeenCalledExactlyOnceWith(
        { type: "replica:canvas:selection-toggle-requested", nonce: "current-shortcut" },
        origin,
      )
      request({ ...optIn, nonce: "current-shortcut", selectionShortcut: false })
      post.mockClear()
      expect(press().defaultPrevented).toBe(false)
      expect(post).not.toHaveBeenCalled()
    } finally {
      bridgeWindow[installed]?.()
    }
  })

  it("respects a shortcut handled by the prototype", () => {
    const post = vi.spyOn(window, "postMessage")
    const bridgeWindow = window as Window & { [installed]?: () => void }
    const target = document.createElement("button")
    document.body.append(target)
    installBridge(origin)
    window.dispatchEvent(
      new MessageEvent("message", {
        origin,
        source: window,
        data: {
          type: "replica:canvas:request-ready",
          nonce: "shortcut",
          selectionShortcut: true,
        },
      }),
    )
    function handledByPrototype(event: KeyboardEvent) {
      event.preventDefault()
    }
    target.addEventListener("keydown", handledByPrototype)
    post.mockClear()
    try {
      const shortcut = new KeyboardEvent("keydown", {
        key: "s",
        bubbles: true,
        cancelable: true,
      })
      target.dispatchEvent(shortcut)
      expect(shortcut.defaultPrevented).toBe(true)
      expect(post).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "replica:canvas:selection-toggle-requested" }),
        expect.anything(),
      )
    } finally {
      bridgeWindow[installed]?.()
      target.remove()
    }
  })

  it("picks an element without activating its underlying control", () => {
    withSelection(({ target, pointer, anchor }) => {
      const activated = vi.fn()
      target.addEventListener("click", activated)
      pointer("pointerdown", 40, 40)
      pointer("pointerup", 42, 42)
      expect(anchor()).toMatchObject({
        kind: "element",
        selector: "#save",
        accessibleName: "Save changes",
        rect: { x: 20, y: 30, width: 120, height: 40 },
        route: { pathname: "/", search: "", hash: "" },
      })
      expect(activated).not.toHaveBeenCalled()
    })
  })

  it("selects a reverse rectangle and preserves the real route and nearby element context", () => {
    withSelection(({ pointer, anchor }) => {
      pointer("pointerdown", 400, 300)
      pointer("pointermove", 100, 100)
      pointer("pointerup", 100, 100)
      expect(anchor()).toMatchObject({
        kind: "area",
        rect: { x: 100, y: 100, width: 300, height: 200 },
        elements: [{ selector: "#save", accessibleName: "Save changes" }],
      })
    })
  })

  it.each([
    [7, 8, false],
    [8, 7, false],
    [8, 8, true],
  ])("requires eight pixels in both rectangle dimensions (%s by %s)", (width, height, accepted) => {
    withSelection(({ pointer, post, anchor }) => {
      pointer("pointerdown", 100, 100)
      pointer("pointerup", 100 + width, 100 + height)
      if (accepted) expect(anchor().kind).toBe("area")
      else
        expect(post).toHaveBeenLastCalledWith(
          {
            type: "replica:canvas:selection-failed",
            nonce: "improvement",
            reason: "area-too-small",
          },
          origin,
        )
    })
  })

  it.each(["pointercancel", "lostpointercapture"])(
    "cleans up an interrupted %s gesture",
    (event) => {
      withSelection(({ surface, pointer, post }) => {
        pointer("pointerdown", 100, 100)
        surface.dispatchEvent(new Event(event))
        pointer("pointerup", 300, 300)
        expect(post.mock.calls.some(([message]) => isSelectionMessage(message))).toBe(false)
        expect(
          document.querySelector('[data-replica-canvas-bridge][style*="crosshair"]'),
        ).toBeNull()
      })
    },
  )

  it("supports keyboard element activation without submitting or navigating", () => {
    withSelection(({ target, anchor }) => {
      const activated = vi.fn()
      target.addEventListener("click", activated)
      target.click()
      expect(anchor().kind).toBe("element")
      expect(activated).not.toHaveBeenCalled()
    })
  })

  it("offers two-corner keyboard selection without a visible region picker", () => {
    withSelection(({ anchor }) => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, cancelable: true }),
      )
      for (const key of ["Enter", "ArrowLeft", "ArrowUp", "Enter"]) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true }))
      }
      expect(anchor()).toMatchObject({ kind: "area", rect: { width: 10, height: 10 } })
    })
  })
})
