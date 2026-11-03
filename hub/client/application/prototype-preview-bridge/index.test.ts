// @vitest-environment jsdom
import { beforeEach, expect, it, onTestFinished, vi } from "vitest"

import { REVIEW_ANCHOR_SCHEMA } from "@utils/review-anchor/schemas"

import { installBridge } from "."

beforeEach(() => {
  onTestFinished(() => {
    const bridgeWindow = window as Window & { [installed]?: () => void }
    bridgeWindow[installed]?.()
  })
  installBridge("http://127.0.0.1:1234")
})

const TEXT_ENCODER = new TextEncoder()
const installed = Symbol.for("replica.canvas.bridge.v1")

function boundedText(maximumBytes: number, character: string, remainingBytes: number) {
  const prefix = "a".repeat(maximumBytes - remainingBytes)
  return {
    input: `${prefix}${character}suffix`,
    expected: prefix + (TEXT_ENCODER.encode(character).length <= remainingBytes ? character : ""),
  }
}

it.each(["static", "fixed", "sticky"])(
  "updates a %s-ancestor pin on scroll instead of waiting for polling",
  async (position) => {
    installBridge("http://127.0.0.1:1234")
    document.body.innerHTML = `<section style="position: ${position}"><button id="save">Save</button></section>`
    let top = 300
    const bounds = vi
      .spyOn(document.querySelector("button")!, "getBoundingClientRect")
      .mockImplementation(() => ({
        x: 20,
        y: top,
        left: 20,
        top,
        right: 120,
        bottom: top + 32,
        width: 100,
        height: 32,
        toJSON: () => ({}),
      }))
    const post = vi.spyOn(window, "postMessage")
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        origin: "http://127.0.0.1:1234",
        data: {
          type: "replica:canvas:resolve",
          nonce: "scroll",
          anchors: [
            {
              id: 1,
              anchor: {
                kind: "element",
                route: { pathname: "/", search: "", hash: "" },
                selector: "#save",
                accessibleName: "",
                tagName: "button",
                elementOffset: { x: 0.5, y: 0.5 },
              },
            },
          ],
        },
      }),
    )
    bounds.mockClear()
    vi.stubGlobal("scrollY", 120)
    if (position === "static") top -= 120
    document.dispatchEvent(new Event("scroll"))
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({
        results: [{ id: 1, x: 70, y: position === "static" ? 196 : 316 }],
      }),
      "http://127.0.0.1:1234",
    )
    if (position === "static") expect(bounds).not.toHaveBeenCalled()
    else expect(bounds).toHaveBeenCalled()
    top = 140
    document.querySelector("section")!.dispatchEvent(new Event("scroll"))
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({
        results: [{ id: 1, x: 70, y: 156 }],
      }),
      "http://127.0.0.1:1234",
    )
    top = 100
    window.dispatchEvent(new Event("resize"))
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({
        results: [{ id: 1, x: 70, y: 116 }],
      }),
      "http://127.0.0.1:1234",
    )
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(post).toHaveBeenLastCalledWith(
      {
        type: "replica:canvas:conversation-dismiss-requested",
        nonce: "scroll",
      },
      "http://127.0.0.1:1234",
    )
  },
)

it.each([
  "prevent-default",
  "element",
  "area",
  "replace-request",
  "same-nonce-request",
  "uninstall",
])("does not forward Escape after a later window listener handles it with %s", async (action) => {
  const post = vi.spyOn(window, "postMessage")
  function send(type: string, payload: object = {}) {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        origin: "http://127.0.0.1:1234",
        data: { type, nonce: "escape", ...payload },
      }),
    )
  }
  send("replica:canvas:resolve", { anchors: [] })
  post.mockClear()
  function laterListener(event: KeyboardEvent) {
    if (action === "prevent-default") event.preventDefault()
    else if (action === "replace-request")
      send("replica:canvas:resolve", { anchors: [], nonce: "replacement" })
    else if (action === "same-nonce-request") send("replica:canvas:resolve", { anchors: [] })
    else if (action === "uninstall")
      (window as Window & { [installed]?: () => void })[installed]?.()
    else send("replica:canvas:select", { mode: action })
  }
  window.addEventListener("keydown", laterListener)
  try {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(post).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "replica:canvas:conversation-dismiss-requested" }),
      expect.anything(),
    )
  } finally {
    window.removeEventListener("keydown", laterListener)
  }
})

it.each(["element", "area"])(
  "updates existing and new %s selection overlays from the trusted parent's theme",
  (mode) => {
    installBridge("http://127.0.0.1:1234")
    vi.stubGlobal("CSS", {
      supports: (property: string, value: string) =>
        property === "color" && /^#[\da-f]{6}$/i.test(value),
    })
    function send(type: string, payload: object = {}, origin = "http://127.0.0.1:1234") {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin,
          source: window,
          data: { type, nonce: "theme", ...payload },
        }),
      )
    }
    send("replica:canvas:theme", { accent: "#0969da" })
    send("replica:canvas:select", { mode })
    const overlay = document.documentElement.querySelector<HTMLElement>(
      ":scope > [data-replica-canvas-bridge]",
    )!
    expect(overlay.style.getPropertyValue("--replica-selection-accent")).toBe("#0969da")
    expect(overlay.style.background).toContain("var(--replica-selection-accent)")
    send("replica:canvas:theme", { accent: "#58a6ff" }, "http://127.0.0.1:9999")
    send("replica:canvas:theme", { accent: "not-a-color" })
    send("replica:canvas:theme", { accent: null })
    expect(overlay.style.getPropertyValue("--replica-selection-accent")).toBe("#0969da")
    send("replica:canvas:theme", { accent: "#58a6ff" })
    expect(overlay.style.getPropertyValue("--replica-selection-accent")).toBe("#58a6ff")
    expect(document.documentElement.querySelector(":scope > [data-replica-canvas-bridge]")).toBe(
      overlay,
    )
    send("replica:canvas:select", { mode })
    const replacement = document.documentElement.querySelector<HTMLElement>(
      ":scope > [data-replica-canvas-bridge]",
    )!
    expect(replacement).not.toBe(overlay)
    expect(replacement.style.getPropertyValue("--replica-selection-accent")).toBe("#58a6ff")
    send("replica:canvas:cancel-selection")
  },
)

it("binds messages to the registered parent and ignores malformed anchor entries", () => {
  const post = vi.spyOn(window, "postMessage")
  function send(origin: string, anchors: unknown[]) {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin,
        source: window,
        data: { type: "replica:canvas:resolve", nonce: "invalid", anchors },
      }),
    )
  }
  send("http://127.0.0.1:9999", [])
  expect(post).not.toHaveBeenCalled()
  send("http://127.0.0.1:1234", [null, { id: 1, anchor: null }, { id: 2, anchor: { route: {} } }])
  expect(post).toHaveBeenLastCalledWith(
    {
      type: "replica:canvas:resolved",
      protocolVersion: 1,
      nonce: "invalid",
      route: { pathname: "/", search: "", hash: "" },
      results: [],
    },
    "http://127.0.0.1:1234",
  )
})

it("ignores another window even when it claims the registered parent origin", () => {
  const post = vi.spyOn(window, "postMessage")
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "http://127.0.0.1:1234",
      source: null,
      data: { type: "replica:canvas:request-ready", nonce: "untrusted" },
    }),
  )
  const otherFrame = document.createElement("iframe")
  document.body.append(otherFrame)
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "http://127.0.0.1:1234",
      source: otherFrame.contentWindow,
      data: { type: "replica:canvas:request-ready", nonce: "untrusted" },
    }),
  )
  expect(post).not.toHaveBeenCalled()
})

it("does not activate local canvas review on a Hub-served preview", () => {
  document.body.innerHTML = '<script src="/__replica/bridge/v1.js"></script>'
  const post = vi.spyOn(window, "postMessage")
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "http://127.0.0.1:1234",
      source: window,
      data: { type: "replica:canvas:request-ready", nonce: "hub-preview" },
    }),
  )
  expect(post).not.toHaveBeenCalled()
})

it("places a marker only for a uniquely matched element from the local canvas", () => {
  document.body.innerHTML =
    '<label id="button-label">Save action</label><button id="save" aria-labelledby="button-label">Save</button>'
  const button = document.querySelector("button")!
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
    left: 10,
    top: 20,
    width: 100,
    height: 40,
    right: 110,
    bottom: 60,
    x: 10,
    y: 20,
    toJSON: () => ({}),
  })
  const post = vi.spyOn(window, "postMessage")
  const anchor = {
    schemaVersion: 1,
    kind: "element",
    route: { pathname: "/", search: "", hash: "" },
    selector: "#save",
    accessibleName: "Save action",
    tagName: "button",
    elementOffset: { x: 0.5, y: 0.5 },
  }
  function send(origin: string, value: typeof anchor & { selectedText?: string }) {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin,
        source: window,
        data: {
          type: "replica:canvas:resolve",
          nonce: "test",
          anchors: [{ id: 1, anchor: value }],
        },
      }),
    )
  }

  send("https://example.com", anchor)
  expect(post).not.toHaveBeenCalled()
  send("http://127.0.0.1:1234", { ...anchor, accessibleName: "Wrong" })
  expect(post).toHaveBeenLastCalledWith(
    {
      type: "replica:canvas:resolved",
      protocolVersion: 1,
      nonce: "test",
      route: { pathname: "/", search: "", hash: "" },
      results: [],
    },
    "http://127.0.0.1:1234",
  )
  send("http://127.0.0.1:1234", anchor)
  expect(post).toHaveBeenLastCalledWith(
    {
      type: "replica:canvas:resolved",
      protocolVersion: 1,
      nonce: "test",
      route: { pathname: "/", search: "", hash: "" },
      results: [{ id: 1, x: 60, y: 40 }],
    },
    "http://127.0.0.1:1234",
  )
  send("http://127.0.0.1:1234", {
    ...anchor,
    selector: "#old-save",
    selectedText: "Save",
  })
  expect(post).toHaveBeenLastCalledWith(
    {
      type: "replica:canvas:resolved",
      protocolVersion: 1,
      nonce: "test",
      route: { pathname: "/", search: "", hash: "" },
      results: [{ id: 1, x: 60, y: 40 }],
    },
    "http://127.0.0.1:1234",
  )
})

it("keeps Controls settings out of comment routes without hiding app route changes", () => {
  const previousUrl = window.location.href
  const route = {
    pathname: "/dashboard",
    search: "",
    hash: "#/dashboard",
  }
  document.body.innerHTML = '<button id="save">Save</button>'
  vi.spyOn(document.querySelector("button")!, "getBoundingClientRect").mockReturnValue(
    new DOMRect(10, 20, 100, 40),
  )
  const post = vi.spyOn(window, "postMessage")
  function send(type: string, payload: object = {}) {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        origin: "http://127.0.0.1:1234",
        data: { type, nonce: "controls-route", ...payload },
      }),
    )
  }
  const anchors = [
    {
      id: 1,
      anchor: {
        kind: "element",
        route,
        selector: "#save",
        accessibleName: "",
        tagName: "button",
        elementOffset: { x: 0.5, y: 0.5 },
      },
    },
    {
      id: 2,
      anchor: { kind: "area", route, rect: { x: 10, y: 20, width: 100, height: 40 } },
    },
  ]
  try {
    window.history.replaceState({ router: "retained" }, "", "/dashboard?rc=1#/dashboard")
    send("replica:canvas:request-ready")
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "replica:canvas:ready", route }),
      "http://127.0.0.1:1234",
    )
    send("replica:canvas:resolve", { anchors })
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "replica:canvas:resolved",
        route,
        results: [
          { id: 1, x: 60, y: 40 },
          { id: 2, x: 110, y: 20, rect: { x: 10, y: 20, width: 100, height: 40 } },
        ],
      }),
      "http://127.0.0.1:1234",
    )
    expect(window.location.search).toContain("rc=1")
    expect(window.history.state).toEqual({ router: "retained" })

    window.history.replaceState(
      {},
      "",
      "/dashboard?tab=profile%20details&rc=1&%72%63.page.title=Edited&rcExtra=keep#/dashboard",
    )
    send("replica:canvas:request-ready")
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({
        route: { ...route, search: "?tab=profile%20details&rcExtra=keep" },
      }),
      "http://127.0.0.1:1234",
    )
    for (const url of [
      "/dashboard?tab=other&rc=1#/dashboard",
      "/other?rc=1#/dashboard",
      "/dashboard?rc=1#/other",
    ]) {
      window.history.replaceState({}, "", url)
      send("replica:canvas:resolve", { anchors })
      expect(post).toHaveBeenLastCalledWith(
        expect.objectContaining({ results: [] }),
        "http://127.0.0.1:1234",
      )
    }
  } finally {
    window.history.replaceState(null, "", previousUrl)
  }
})

it("replaces Canvas routes for in-place hash edits and resets, not app navigation", () => {
  const previousUrl = window.location.href
  const post = vi.spyOn(window, "postMessage")
  const length = window.history.length
  function send(type: string) {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        origin: "http://127.0.0.1:1234",
        data: { type, nonce: "in-place-hash", anchors: [] },
      }),
    )
  }
  try {
    for (const hash of ["#edited", "#default"]) {
      window.history.replaceState({ router: "retained" }, "", `/?rc=1${hash}`)
      const event = new Event("hashchange")
      Object.defineProperty(event, "replicaControlsBinding", { value: true })
      window.dispatchEvent(event)
      send("replica:canvas:request-ready")
      expect(post.mock.calls.at(-1)?.[0]).toMatchObject({
        type: "replica:canvas:ready",
        route: { pathname: "/", search: "", hash },
        replaceRoute: true,
      })
      send("replica:canvas:resolve")
      expect(post.mock.calls.at(-1)?.[0]).toMatchObject({
        type: "replica:canvas:resolved",
        replaceRoute: true,
      })
    }
    expect(window.history.state).toEqual({ router: "retained" })
    expect(window.history.length).toBe(length)

    window.history.replaceState({}, "", "/#app")
    send("replica:canvas:request-ready")
    expect(post.mock.calls.at(-1)?.[0]).not.toHaveProperty("replaceRoute")
    window.history.replaceState({}, "", "/#default")
    window.dispatchEvent(new HashChangeEvent("hashchange"))
    send("replica:canvas:request-ready")
    expect(post.mock.calls.at(-1)?.[0]).not.toHaveProperty("replaceRoute")
  } finally {
    window.history.replaceState(null, "", previousUrl)
  }
})

it("returns a failed click result for a malformed link", () => {
  document.body.innerHTML = '<a id="invalid" href="http://[">Open preview</a>'
  const link = document.querySelector("a")!
  vi.spyOn(link, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 100, 40))
  const hitTest = Object.getOwnPropertyDescriptor(document, "elementFromPoint")
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => link,
  })
  const post = vi.spyOn(window, "postMessage")
  const click = vi.spyOn(link, "click")
  try {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "http://127.0.0.1:1234",
        source: window,
        data: {
          type: "replica:canvas:click",
          nonce: "invalid-link",
          selector: "#invalid",
          expectedLabel: "Open preview",
          route: { pathname: "/", search: "", hash: "" },
        },
      }),
    )
    expect(post).toHaveBeenLastCalledWith(
      {
        type: "replica:canvas:click-result",
        nonce: "invalid-link",
        clicked: false,
        error: "The target is hidden, blocked, disabled, unsafe, or its accessible name changed.",
      },
      "http://127.0.0.1:1234",
    )
    expect(click).not.toHaveBeenCalled()
  } finally {
    if (hitTest) Object.defineProperty(document, "elementFromPoint", hitTest)
    else Reflect.deleteProperty(document, "elementFromPoint")
  }
})

it("creates a document-positioned element overlay outside a positioned body", () => {
  document.body.innerHTML = '<button id="save" aria-label="Save changes">Save</button>'
  document.body.style.position = "relative"
  const button = document.querySelector("button")!
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
    left: 10,
    top: 20,
    width: 100,
    height: 40,
    right: 110,
    bottom: 60,
    x: 10,
    y: 20,
    toJSON: () => ({}),
  })
  const post = vi.spyOn(window, "postMessage")

  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "http://127.0.0.1:1234",
      source: window,
      data: { type: "replica:canvas:request-ready", nonce: "selection" },
    }),
  )
  expect(post).toHaveBeenLastCalledWith(
    {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      nonce: "selection",
      route: { pathname: "/", search: "", hash: "" },
    },
    "http://127.0.0.1:1234",
  )

  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "http://127.0.0.1:1234",
      source: window,
      data: { type: "replica:canvas:select", nonce: "selection", mode: "element" },
    }),
  )
  button.dispatchEvent(
    new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 60,
      clientY: 40,
    }),
  )
  button.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: 60,
      clientY: 40,
    }),
  )

  expect(post).toHaveBeenLastCalledWith(
    {
      type: "replica:canvas:selected",
      nonce: "selection",
      anchor: {
        schemaVersion: 1,
        kind: "element",
        route: { pathname: "/", search: "", hash: "" },
        selector: "#save",
        accessibleName: "Save changes",
        tagName: "button",
        selectedText: "",
        rect: { x: 10, y: 20, width: 100, height: 40 },
        viewport: { width: window.innerWidth, height: window.innerHeight, scrollX: 0, scrollY: 0 },
        elementOffset: { x: 0.5, y: 0.5 },
      },
    },
    "http://127.0.0.1:1234",
  )
  const overlay = document.querySelector<HTMLElement>("[data-replica-canvas-bridge]")!
  expect(overlay.parentElement).toBe(document.documentElement)
  expect(overlay.style.position).toBe("absolute")
  expect(overlay.style.left).toBe("10px")
  expect(overlay.style.top).toBe("20px")
})

it.each([
  { label: "ASCII", character: "a", remainingBytes: 1 },
  { label: "a middle dot over the byte limit", character: "\u00b7", remainingBytes: 1 },
  { label: "an emoji at the byte limit", character: "\u{1f600}", remainingBytes: 4 },
  { label: "an emoji over the byte limit", character: "\u{1f600}", remainingBytes: 1 },
])("creates a schema-valid area anchor with $label", ({ character, remainingBytes }) => {
  document.body.innerHTML = '<main id="content">Welcome</main>'
  const content = document.querySelector("main")!
  const text = boundedText(500, character, remainingBytes)
  const name = boundedText(1000, character, remainingBytes)
  const role = boundedText(64, character, remainingBytes)
  content.textContent = text.input
  content.setAttribute("aria-label", name.input)
  content.setAttribute("role", role.input)
  vi.spyOn(content, "getBoundingClientRect").mockReturnValue({
    left: 10,
    top: 20,
    width: 200,
    height: 100,
    right: 210,
    bottom: 120,
    x: 10,
    y: 20,
    toJSON: () => ({}),
  })
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: vi.fn(() => [content]),
  })
  const post = vi.spyOn(window, "postMessage")

  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "http://127.0.0.1:1234",
      source: window,
      data: { type: "replica:canvas:select", nonce: "area", mode: "area" },
    }),
  )
  const surface = Array.from(
    document.querySelectorAll<HTMLElement>("[data-replica-canvas-bridge]"),
  ).find((element) => element.style.cursor === "crosshair")!
  Object.defineProperty(surface, "setPointerCapture", { value: vi.fn() })
  surface.dispatchEvent(
    new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX: 20,
      clientY: 30,
    }),
  )
  surface.dispatchEvent(
    new MouseEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 80,
    }),
  )
  surface.dispatchEvent(
    new MouseEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 80,
    }),
  )

  const selected = post.mock.calls
    .map(([message]): unknown => message)
    .find(
      (message): message is { type: unknown; anchor?: unknown } =>
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "replica:canvas:selected",
    )
  expect(selected).toMatchObject({
    type: "replica:canvas:selected",
    nonce: "area",
    anchor: {
      schemaVersion: 1,
      kind: "area",
      route: { pathname: "/", search: "", hash: "" },
      rect: { x: 20, y: 30, width: 100, height: 50 },
      elements: [
        {
          selector: "#content",
          tagName: "main",
          accessibleName: name.expected,
          role: role.expected,
          textExcerpt: text.expected,
        },
      ],
    },
  })
  const parsed = REVIEW_ANCHOR_SCHEMA.safeParse(selected?.anchor)
  expect(parsed.success).toBe(true)
  if (!parsed.success || parsed.data.kind !== "area")
    throw new Error("Expected a valid area anchor")
  const context = parsed.data.elements[0]
  if (!context) throw new Error("Expected sampled element context")
  expect(TEXT_ENCODER.encode(context.textExcerpt).length).toBeLessThanOrEqual(500)
  expect(TEXT_ENCODER.encode(context.accessibleName).length).toBeLessThanOrEqual(1000)
  expect(TEXT_ENCODER.encode(context.role).length).toBeLessThanOrEqual(64)

  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "http://127.0.0.1:1234",
      source: window,
      data: {
        type: "replica:canvas:resolve",
        nonce: "area-resolution",
        anchors: [
          { id: 2, anchor: selected && "anchor" in selected ? selected.anchor : undefined },
        ],
      },
    }),
  )
  expect(post).toHaveBeenLastCalledWith(
    {
      type: "replica:canvas:resolved",
      protocolVersion: 1,
      nonce: "area-resolution",
      route: { pathname: "/", search: "", hash: "" },
      results: [
        {
          id: 2,
          x: 120,
          y: 30,
          rect: { x: 20, y: 30, width: 100, height: 50 },
        },
      ],
    },
    "http://127.0.0.1:1234",
  )
  for (const type of ["replica:canvas:cancel-selection", "replica:canvas:clear-selection"]) {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "http://127.0.0.1:1234",
        source: window,
        data: { type, nonce: "area" },
      }),
    )
  }
  expect(document.querySelector("[data-replica-canvas-bridge]")).toBeNull()
})

it.each([
  { character: "\u00b7", remainingBytes: 1 },
  { character: "\u{1f600}", remainingBytes: 4 },
  { character: "\u{1f600}", remainingBytes: 1 },
])(
  "bounds element names and selected text in UTF-8 bytes: $character/$remainingBytes",
  ({ character, remainingBytes }) => {
    document.body.innerHTML = '<button id="save"></button>'
    const button = document.querySelector("button")!
    const name = boundedText(1000, character, remainingBytes)
    const text = boundedText(2000, character, remainingBytes)
    button.setAttribute("aria-label", name.input)
    button.textContent = text.input
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 100, 40))
    const range = document.createRange()
    range.selectNodeContents(button)
    window.getSelection()?.addRange(range)
    const post = vi.spyOn(window, "postMessage")

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "http://127.0.0.1:1234",
        source: window,
        data: { type: "replica:canvas:select", nonce: "element-bytes", mode: "element" },
      }),
    )
    button.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 60, clientY: 40 }))
    button.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 60, clientY: 40 }),
    )

    const selected = post.mock.calls
      .map(([message]): unknown => message)
      .find(
        (message): message is { type: unknown; anchor?: unknown } =>
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "replica:canvas:selected",
      )
    const parsed = REVIEW_ANCHOR_SCHEMA.safeParse(selected?.anchor)
    expect(parsed.success).toBe(true)
    if (!parsed.success || parsed.data.kind !== "element")
      throw new Error("Expected a valid element anchor")
    expect(parsed.data.accessibleName).toBe(name.expected)
    expect(parsed.data.selectedText).toBe(text.expected)
    expect(TEXT_ENCODER.encode(parsed.data.accessibleName).length).toBeLessThanOrEqual(1000)
    expect(TEXT_ENCODER.encode(parsed.data.selectedText).length).toBeLessThanOrEqual(2000)
  },
)

it("removes an active region selection when the renderer rejects an anchor", () => {
  for (const data of [
    { type: "replica:canvas:select", mode: "area" },
    { type: "replica:canvas:cancel-selection" },
    { type: "replica:canvas:clear-selection" },
  ]) {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "http://127.0.0.1:1234",
        source: window,
        data: { ...data, nonce: "rejected-area" },
      }),
    )
    if (data.type === "replica:canvas:select")
      expect(document.querySelector("[data-replica-canvas-bridge]")).not.toBeNull()
  }
  expect(document.querySelector("[data-replica-canvas-bridge]")).toBeNull()
})
