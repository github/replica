import { readFileSync } from "node:fs"

import { JSDOM } from "jsdom"
import type { DOMWindow } from "jsdom"
import { vi } from "vitest"

const HUB_ORIGIN = "http://replica.localhost:19500"
const PREVIEW_ORIGIN = "http://b1.preview.replica.localhost:19500"
const BRIDGE_SOURCE = readFileSync(
  "app/features/install-replica-preview-bridge/index.js",
  "utf8",
).replace('"__REPLICA_HUB_ORIGIN__"', JSON.stringify(HUB_ORIGIN))

export function createPreviewBridgeTestHarness() {
  const windows: JSDOM[] = []
  const animationFrameTimers = new Map<JSDOM, Set<number>>()

  function bridgeWindow({ reviewEnabled = true } = {}) {
    const parent = new JSDOM("", { url: HUB_ORIGIN })
    const preview = new JSDOM("<!doctype html><body></body>", {
      pretendToBeVisual: true,
      runScripts: "outside-only",
      url: PREVIEW_ORIGIN,
    })
    windows.push(parent, preview)
    Object.defineProperty(preview.window, "parent", { value: parent.window })
    Object.defineProperty(preview.window, "TextEncoder", { value: TextEncoder })
    const timers = new Set<number>()

    preview.window.requestAnimationFrame = (callback) => {
      let timer = 0
      timer = preview.window.setTimeout(() => {
        timers.delete(timer)
        callback(preview.window.performance.now())
      })
      timers.add(timer)
      return timer
    }
    preview.window.cancelAnimationFrame = (timer) => {
      timers.delete(timer)
      preview.window.clearTimeout(timer)
    }
    animationFrameTimers.set(preview, timers)
    const postMessage = vi.spyOn(parent.window, "postMessage").mockImplementation(() => undefined)
    preview.window.eval(BRIDGE_SOURCE.replace("__REPLICA_REVIEW_ENABLED__", String(reviewEnabled)))
    return { parent: parent.window, postMessage, preview: preview.window }
  }

  function message(type: string, payload: Record<string, unknown> = {}) {
    return {
      protocolVersion: 1,
      requestId: "request-1",
      type,
      payload,
    }
  }

  function dispatchMessage(
    targetWindow: DOMWindow,
    sourceWindow: DOMWindow,
    data: unknown,
    origin = HUB_ORIGIN,
  ) {
    const event = new targetWindow.MessageEvent("message", { data, origin })
    Object.defineProperty(event, "source", { value: sourceWindow })
    targetWindow.dispatchEvent(event)
  }

  function anchor(overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: 1,
      kind: "element",
      route: { pathname: "/", search: "", hash: "" },
      selector: "#save",
      accessibleName: "Save",
      tagName: "button",
      selectedText: "",
      rect: { x: 20, y: 30, width: 100, height: 32 },
      viewport: { width: 1_280, height: 720, scrollX: 0, scrollY: 0 },
      elementOffset: { x: 0.5, y: 0.5 },
      ...overrides,
    }
  }

  function areaAnchor(overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: 1,
      kind: "area",
      route: { pathname: "/", search: "", hash: "" },
      path: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      rect: { x: 20, y: 30, width: 100, height: 60 },
      viewport: { width: 1_280, height: 720, scrollX: 0, scrollY: 0 },
      elements: [
        {
          selector: "#save",
          accessibleName: "Save",
          tagName: "button",
          role: "",
          textExcerpt: "Save changes",
          rect: { x: 20, y: 30, width: 100, height: 32 },
        },
      ],
      ...overrides,
    }
  }

  function postedMessages(postMessage: { mock: { calls: unknown[][] } }): unknown[] {
    return postMessage.mock.calls.map((call) => call[0])
  }

  async function renderFrames(preview: DOMWindow, count = 2) {
    for (let frame = 0; frame < count; frame += 1) {
      await new Promise<void>((resolve) => preview.requestAnimationFrame(() => resolve()))
    }
  }

  async function close() {
    await Promise.resolve()
    for (const dom of windows) {
      for (const timer of animationFrameTimers.get(dom) || []) {
        dom.window.clearTimeout(timer)
      }
      dom.window.close()
    }
    windows.length = 0
    animationFrameTimers.clear()
  }

  return {
    anchor,
    areaAnchor,
    bridgeWindow,
    close,
    dispatchMessage,
    message,
    postedMessages,
    renderFrames,
  }
}
