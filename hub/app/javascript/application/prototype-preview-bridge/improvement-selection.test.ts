// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

import { REVIEW_ANCHOR_SCHEMA } from "@utils/review-anchor/schemas"
import { installBridge } from "."

const origin = "http://127.0.0.1:1234"
const installed = Symbol.for("replica.canvas.bridge.v1")

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
