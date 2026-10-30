import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { AnchorReference } from "@utils/review-anchor/types"
import type { PreviewBridgeCommand, PreviewBridgeMessage } from "@utils/preview-bridge/types"

import { usePreviewBridge } from "."

const PREVIEW_URL = "http://b1.preview.replica.localhost:19500/"
const PREVIEW_ORIGIN = new URL(PREVIEW_URL).origin
const REQUEST_ID = "00000000-0000-4000-8000-000000000001"
const EMPTY_ANCHORS: AnchorReference[] = []
const ANCHOR_REFERENCE: AnchorReference = {
  commentId: 1,
  originBuild: true,
  anchor: {
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
  },
}
const READY_MESSAGE: PreviewBridgeMessage = {
  protocolVersion: 1,
  requestId: "bridge-request",
  type: "replica:bridge:ready",
  payload: { route: { pathname: "/", search: "", hash: "" } },
}

describe("usePreviewBridge()", () => {
  it("accepts conversation dismissal only from the trusted review-enabled frame", () => {
    const iframe = document.createElement("iframe")
    document.body.append(iframe)
    const frameWindow = iframe.contentWindow!
    const dismiss = vi.fn()
    window.addEventListener("replica:review-dismiss", dismiss)
    const { rerender, unmount } = renderHook(
      ({ reviewEnabled }) =>
        usePreviewBridge({
          iframeRef: { current: iframe },
          previewUrl: PREVIEW_URL,
          previewTheme: "light",
          anchors: EMPTY_ANCHORS,
          reviewEnabled,
        }),
      { initialProps: { reviewEnabled: true } },
    )
    function receive(origin = PREVIEW_ORIGIN, source: Window = frameWindow, payload = {}) {
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin,
            source,
            data: {
              protocolVersion: 1,
              requestId: REQUEST_ID,
              type: "replica:bridge:conversation-dismiss-requested",
              payload,
            },
          }),
        )
      })
    }
    receive("https://example.com")
    receive(PREVIEW_ORIGIN, window)
    receive(PREVIEW_ORIGIN, frameWindow, { unexpected: true })
    expect(dismiss).not.toHaveBeenCalled()
    receive()
    expect(dismiss).toHaveBeenCalledOnce()
    rerender({ reviewEnabled: false })
    receive()
    expect(dismiss).toHaveBeenCalledOnce()
    unmount()
    window.removeEventListener("replica:review-dismiss", dismiss)
    iframe.remove()
  })

  it.each([true, false])(
    "restores section fragments before reporting readiness, with review enabled %s",
    (reviewEnabled) => {
      const iframe = document.createElement("iframe")
      document.body.append(iframe)
      const frameWindow = iframe.contentWindow
      if (!frameWindow) throw new Error("Expected iframe content window")

      const commands: PreviewBridgeCommand[] = []
      vi.spyOn(frameWindow, "postMessage").mockImplementation((command: PreviewBridgeCommand) => {
        commands.push(command)
      })
      const requestedRoute = { pathname: "/", search: "?filter=active", hash: "#stations" }
      const loadedRoute = { ...requestedRoute, hash: "" }
      const { result } = renderHook(() =>
        usePreviewBridge({
          iframeRef: { current: iframe },
          previewUrl: `${PREVIEW_URL}?filter=active#stations`,
          previewTheme: "light",
          anchors: EMPTY_ANCHORS,
          reviewEnabled,
        }),
      )
      function receive(data: PreviewBridgeMessage) {
        window.dispatchEvent(
          new MessageEvent("message", {
            data,
            origin: PREVIEW_ORIGIN,
            source: frameWindow,
          }),
        )
      }

      act(() => {
        result.current.handleFrameLoad()
        receive({
          ...READY_MESSAGE,
          type: "replica:bridge:route-changed",
          payload: { route: loadedRoute },
        })
        receive({ ...READY_MESSAGE, payload: { route: loadedRoute } })
      })
      expect(result.current.ready).toBe(false)
      expect(result.current.route).toBeNull()
      const restoration = commands.find(
        (command) => command.type === "replica:bridge:restore-fragment",
      )
      if (!restoration) throw new Error("Expected fragment restoration command")
      expect(restoration.payload).toEqual({ route: requestedRoute })
      expect(commands.map((command) => command.type)).toEqual([
        "replica:bridge:request-ready",
        "replica:bridge:restore-fragment",
      ])

      act(() => {
        receive({ ...READY_MESSAGE, payload: { route: loadedRoute } })
        receive({
          ...READY_MESSAGE,
          type: "replica:bridge:route-changed",
          payload: { route: requestedRoute },
        })
      })
      expect(result.current.ready).toBe(false)
      expect(result.current.route).toBeNull()
      expect(
        commands.filter((command) => command.type === "replica:bridge:restore-fragment"),
      ).toHaveLength(1)

      act(() => {
        receive({
          ...READY_MESSAGE,
          requestId: restoration.requestId,
          payload: { route: requestedRoute },
        })
      })
      expect(result.current.ready).toBe(true)
      expect(result.current.route).toEqual(requestedRoute)

      act(() => {
        receive({
          ...READY_MESSAGE,
          type: "replica:bridge:route-changed",
          payload: { route: { ...requestedRoute, hash: "#top" } },
        })
      })
      expect(result.current.route?.hash).toBe("#top")
      act(() => {
        result.current.handleFrameLoad()
        receive({ ...READY_MESSAGE, payload: { route: loadedRoute } })
      })
      expect(result.current.ready).toBe(false)
      expect(result.current.route).toBeNull()
      expect(
        commands.filter((command) => command.type === "replica:bridge:restore-fragment"),
      ).toHaveLength(2)
    },
  )

  it.each(["#/about", "#!/settings"])("loads the hash route %s without fragment replay", (hash) => {
    const iframe = document.createElement("iframe")
    document.body.append(iframe)
    const frameWindow = iframe.contentWindow
    if (!frameWindow) throw new Error("Expected iframe content window")

    const postMessage = vi.spyOn(frameWindow, "postMessage")
    const route = { pathname: "/", search: "", hash }
    const { result } = renderHook(() =>
      usePreviewBridge({
        iframeRef: { current: iframe },
        previewUrl: `${PREVIEW_URL}${hash}`,
        previewTheme: "light",
        anchors: EMPTY_ANCHORS,
      }),
    )
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { ...READY_MESSAGE, payload: { route } },
          origin: PREVIEW_ORIGIN,
          source: frameWindow,
        }),
      )
    })
    expect(result.current.ready).toBe(true)
    expect(result.current.route).toEqual(route)
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "replica:bridge:restore-fragment" }),
      PREVIEW_ORIGIN,
    )
  })

  it("reports an application redirect without replaying the old page's section", () => {
    const iframe = document.createElement("iframe")
    document.body.append(iframe)
    const frameWindow = iframe.contentWindow
    if (!frameWindow) throw new Error("Expected iframe content window")

    const postMessage = vi.spyOn(frameWindow, "postMessage")
    const route = { pathname: "/login", search: "?next=welcome", hash: "" }
    const { result } = renderHook(() =>
      usePreviewBridge({
        iframeRef: { current: iframe },
        previewUrl: `${PREVIEW_URL}#welcome`,
        previewTheme: "light",
        anchors: EMPTY_ANCHORS,
      }),
    )
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { ...READY_MESSAGE, payload: { route } },
          origin: PREVIEW_ORIGIN,
          source: frameWindow,
        }),
      )
    })
    expect(result.current.ready).toBe(true)
    expect(result.current.route).toEqual(route)
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "replica:bridge:restore-fragment" }),
      PREVIEW_ORIGIN,
    )
  })

  it("uses only theme and route messages in browse-only mode", () => {
    const iframe = document.createElement("iframe")
    document.body.append(iframe)
    const frameWindow = iframe.contentWindow
    if (!frameWindow) throw new Error("Expected iframe content window")
    const postMessage = vi.spyOn(frameWindow, "postMessage")
    const onToggleSidebar = vi.fn()
    const { result } = renderHook(() =>
      usePreviewBridge({
        iframeRef: { current: iframe },
        previewUrl: PREVIEW_URL,
        previewTheme: "dark",
        anchors: [ANCHOR_REFERENCE],
        reviewEnabled: false,
        onToggleSidebar,
      }),
    )
    act(() => {
      result.current.handleFrameLoad()
      window.dispatchEvent(
        new MessageEvent("message", {
          data: READY_MESSAGE,
          origin: PREVIEW_ORIGIN,
          source: frameWindow,
        }),
      )
    })
    expect(result.current.ready).toBe(true)
    expect(result.current.route).toEqual({ pathname: "/", search: "", hash: "" })
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "replica:bridge:set-theme",
        payload: { theme: "dark" },
      }),
      PREVIEW_ORIGIN,
    )
    act(() => {
      result.current.startElementSelection()
      result.current.startAreaSelection()
      result.current.focusAnchor(1)
      result.current.clearSelection()
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }))
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "C", shiftKey: true }))
    })
    expect(result.current.selecting).toBe(false)
    expect(onToggleSidebar).not.toHaveBeenCalled()
    expect(postMessage.mock.calls).toEqual([
      [expect.objectContaining({ type: "replica:bridge:request-ready" }), PREVIEW_ORIGIN],
      [expect.objectContaining({ type: "replica:bridge:set-theme" }), PREVIEW_ORIGIN],
    ])
  })

  it("handles Shift+C in Hub and the trusted preview without starting selection", () => {
    const iframe = document.createElement("iframe")
    document.body.append(iframe)
    const frameWindow = iframe.contentWindow
    if (!frameWindow) throw new Error("Expected iframe content window")
    const postMessage = vi.spyOn(frameWindow, "postMessage")
    const onToggleSidebar = vi.fn()
    const iframeRef = { current: iframe }
    const { rerender } = renderHook(
      ({ selectionBlocked }) =>
        usePreviewBridge({
          iframeRef,
          previewUrl: PREVIEW_URL,
          previewTheme: "light",
          anchors: EMPTY_ANCHORS,
          onToggleSidebar,
          selectionBlocked,
        }),
      { initialProps: { selectionBlocked: false } },
    )
    function previewShortcut(origin = PREVIEW_ORIGIN) {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            protocolVersion: 1,
            requestId: "shortcut-request",
            type: "replica:bridge:sidebar-toggle-requested",
            payload: {},
          },
          origin,
          source: frameWindow,
        }),
      )
    }
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: READY_MESSAGE,
          origin: PREVIEW_ORIGIN,
          source: frameWindow,
        }),
      )
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "C", shiftKey: true }))
      previewShortcut()
      previewShortcut("https://example.test")
    })
    expect(onToggleSidebar).toHaveBeenCalledTimes(2)
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "replica:bridge:select-element" }),
      PREVIEW_ORIGIN,
    )

    rerender({ selectionBlocked: true })
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }))
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "C", shiftKey: true }))
      previewShortcut()
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            protocolVersion: 1,
            requestId: "shortcut-request",
            type: "replica:bridge:element-selection-requested",
            payload: {},
          },
          origin: PREVIEW_ORIGIN,
          source: frameWindow,
        }),
      )
    })
    expect(onToggleSidebar).toHaveBeenCalledTimes(2)
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "replica:bridge:select-element" }),
      PREVIEW_ORIGIN,
    )
  })

  it("sends the selected theme on readiness and whenever it changes", () => {
    const iframe = document.createElement("iframe")
    document.body.append(iframe)
    const frameWindow = iframe.contentWindow
    if (!frameWindow) throw new Error("Expected iframe content window")

    const postMessage = vi.spyOn(frameWindow, "postMessage")
    const iframeRef = { current: iframe }
    const initialProps: { previewTheme: "light" | "dark" } = { previewTheme: "light" }
    const { rerender, result } = renderHook(
      ({ previewTheme }: typeof initialProps) =>
        usePreviewBridge({
          iframeRef,
          previewUrl: PREVIEW_URL,
          previewTheme,
          anchors: EMPTY_ANCHORS,
        }),
      { initialProps },
    )

    act(() => result.current.handleFrameLoad())
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: READY_MESSAGE,
          origin: PREVIEW_ORIGIN,
          source: frameWindow,
        }),
      )
    })
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "replica:bridge:set-theme",
        payload: { theme: "light" },
      }),
      PREVIEW_ORIGIN,
    )

    rerender({ previewTheme: "dark" })
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "replica:bridge:set-theme",
        payload: { theme: "dark" },
      }),
      PREVIEW_ORIGIN,
    )
  })

  it("accepts only valid messages from the selected preview frame and origin", () => {
    const iframe = document.createElement("iframe")
    document.body.append(iframe)
    const frameWindow = iframe.contentWindow
    if (!frameWindow) throw new Error("Expected iframe content window")

    const iframeRef = { current: iframe }
    const { result } = renderHook(() =>
      usePreviewBridge({
        iframeRef,
        previewUrl: PREVIEW_URL,
        previewTheme: "light",
        anchors: EMPTY_ANCHORS,
      }),
    )

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: READY_MESSAGE,
          origin: "https://example.test",
          source: frameWindow,
        }),
      )
      window.dispatchEvent(
        new MessageEvent("message", {
          data: READY_MESSAGE,
          origin: PREVIEW_ORIGIN,
          source: window,
        }),
      )
      window.dispatchEvent(
        new MessageEvent("message", {
          data: READY_MESSAGE,
          origin: PREVIEW_ORIGIN,
          source: null,
        }),
      )
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { ...READY_MESSAGE, protocolVersion: 2 },
          origin: PREVIEW_ORIGIN,
          source: frameWindow,
        }),
      )
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { ...READY_MESSAGE, requestId: "" },
          origin: PREVIEW_ORIGIN,
          source: frameWindow,
        }),
      )
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { ...READY_MESSAGE, type: "replica:bridge:unknown" },
          origin: PREVIEW_ORIGIN,
          source: frameWindow,
        }),
      )
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { ...READY_MESSAGE, payload: { ...READY_MESSAGE.payload, extra: true } },
          origin: PREVIEW_ORIGIN,
          source: frameWindow,
        }),
      )
    })

    expect(result.current.ready).toBe(false)

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: READY_MESSAGE,
          origin: PREVIEW_ORIGIN,
          source: frameWindow,
        }),
      )
    })

    expect(result.current.ready).toBe(true)
    expect(result.current.route).toEqual({ pathname: "/", search: "", hash: "" })
  })

  it("does not report the previous Build's page while the next preview loads", () => {
    const iframe = document.createElement("iframe")
    document.body.append(iframe)
    const frameWindow = iframe.contentWindow
    if (!frameWindow) throw new Error("Expected iframe content window")

    const iframeRef = { current: iframe }
    const { result, rerender } = renderHook(
      ({ previewUrl }) =>
        usePreviewBridge({
          iframeRef,
          previewUrl,
          previewTheme: "light",
          anchors: EMPTY_ANCHORS,
        }),
      { initialProps: { previewUrl: PREVIEW_URL } },
    )

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            ...READY_MESSAGE,
            payload: { route: { pathname: "/settings", search: "?tab=profile", hash: "" } },
          },
          origin: PREVIEW_ORIGIN,
          source: frameWindow,
        }),
      )
    })
    expect(result.current.route?.pathname).toBe("/settings")

    rerender({ previewUrl: "http://b2.preview.replica.localhost:19500/" })
    expect(result.current.route).toBeNull()
  })

  it("requests readiness, matches selections, and batches stored anchors", () => {
    const iframe = document.createElement("iframe")
    document.body.append(iframe)
    const frameWindow = iframe.contentWindow
    if (!frameWindow) throw new Error("Expected iframe content window")

    vi.spyOn(crypto, "randomUUID").mockReturnValue(REQUEST_ID)
    const postedMessages: PreviewBridgeCommand[] = []
    const postMessage = vi
      .spyOn(frameWindow, "postMessage")
      .mockImplementation((message: PreviewBridgeCommand) => {
        postedMessages.push(message)
      })
    const iframeRef = { current: iframe }
    const onSelectionStart = vi.fn()
    const anchors = Array.from({ length: 201 }, (_, index) => ({
      ...ANCHOR_REFERENCE,
      commentId: index + 1,
    }))
    const { result } = renderHook(() =>
      usePreviewBridge({
        iframeRef,
        previewUrl: PREVIEW_URL,
        previewTheme: "light",
        anchors,
        onSelectionStart,
      }),
    )

    act(() => result.current.handleFrameLoad())
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "replica:bridge:request-ready" }),
      PREVIEW_ORIGIN,
    )

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: READY_MESSAGE,
          origin: PREVIEW_ORIGIN,
          source: frameWindow,
        }),
      )
    })

    const resolutionMessages = postedMessages.filter(
      (message) => message.type === "replica:bridge:resolve-anchors",
    )
    expect(resolutionMessages).toHaveLength(2)

    const firstMessage = resolutionMessages[0]
    const secondMessage = resolutionMessages[1]
    if (!firstMessage || !secondMessage) throw new Error("Expected resolution batches")

    const firstPayload = firstMessage.payload
    const secondPayload = secondMessage.payload

    expect(firstPayload.replace).toBe(true)
    expect(firstPayload.anchors).toHaveLength(200)
    expect(secondPayload.replace).toBe(false)
    expect(secondPayload.anchors).toHaveLength(1)

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            protocolVersion: 1,
            requestId: "bridge-request",
            type: "replica:bridge:anchors-resolved",
            payload: {
              results: [
                {
                  commentId: 1,
                  status: "resolved",
                  rect: { x: 20, y: 30, width: 100, height: 32 },
                  point: { x: 70, y: 46 },
                },
              ],
            },
          },
          origin: PREVIEW_ORIGIN,
          source: frameWindow,
        }),
      )
    })
    expect(result.current.resolutions.get(1)?.status).toBe("resolved")

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            protocolVersion: 1,
            requestId: "bridge-request",
            type: "replica:bridge:route-changed",
            payload: { route: { pathname: "/settings", search: "", hash: "" } },
          },
          origin: PREVIEW_ORIGIN,
          source: frameWindow,
        }),
      )
    })
    expect(result.current.route).toEqual({ pathname: "/settings", search: "", hash: "" })
    expect(result.current.resolutions.size).toBe(0)

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "c" }))
    })
    expect(postedMessages.at(-1)?.type).toBe("replica:bridge:select-element")
    expect(result.current.selectionMode).toBe("element")
    expect(onSelectionStart).toHaveBeenCalledTimes(1)

    act(() => result.current.cancelSelection())
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "h" }))
    })
    expect(postedMessages.at(-1)?.type).toBe("replica:bridge:select-area")
    expect(result.current.selectionMode).toBe("area")
    expect(onSelectionStart).toHaveBeenCalledTimes(2)

    act(() => result.current.cancelSelection())
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            protocolVersion: 1,
            requestId: REQUEST_ID,
            type: "replica:bridge:selection-cancelled",
            payload: {},
          },
          origin: PREVIEW_ORIGIN,
          source: frameWindow,
        }),
      )
    })
    const input = document.createElement("input")
    document.body.append(input)
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "h" }))
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "c" }))
    })
    expect(onSelectionStart).toHaveBeenCalledTimes(2)
    input.remove()

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            protocolVersion: 1,
            requestId: "shortcut-request",
            type: "replica:bridge:element-selection-requested",
            payload: {},
          },
          origin: PREVIEW_ORIGIN,
          source: frameWindow,
        }),
      )
    })
    expect(postedMessages.at(-1)?.type).toBe("replica:bridge:select-element")
    expect(result.current.selectionMode).toBe("element")
    expect(onSelectionStart).toHaveBeenCalledTimes(3)

    act(() => result.current.cancelSelection())
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            protocolVersion: 1,
            requestId: "shortcut-request",
            type: "replica:bridge:area-selection-requested",
            payload: {},
          },
          origin: PREVIEW_ORIGIN,
          source: frameWindow,
        }),
      )
    })
    expect(postedMessages.at(-1)?.type).toBe("replica:bridge:select-area")
    expect(result.current.selectionMode).toBe("area")
    expect(onSelectionStart).toHaveBeenCalledTimes(4)

    act(() => result.current.cancelSelection())
    expect(postedMessages.at(-1)?.type).toBe("replica:bridge:cancel-selection")
    expect(result.current.selectionMode).toBeNull()

    act(() => result.current.startElementSelection())
    const selectionMessage = postedMessages.find(
      (message) => message.type === "replica:bridge:select-element",
    )
    expect(selectionMessage?.requestId).toBe(REQUEST_ID)
    expect(onSelectionStart).toHaveBeenCalledTimes(5)

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            protocolVersion: 1,
            requestId: "wrong-request",
            type: "replica:bridge:element-selected",
            payload: { anchor: ANCHOR_REFERENCE.anchor },
          },
          origin: PREVIEW_ORIGIN,
          source: frameWindow,
        }),
      )
    })
    expect(result.current.selectedAnchor).toBeNull()

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            protocolVersion: 1,
            requestId: REQUEST_ID,
            type: "replica:bridge:element-selected",
            payload: { anchor: ANCHOR_REFERENCE.anchor },
          },
          origin: PREVIEW_ORIGIN,
          source: frameWindow,
        }),
      )
    })

    expect(result.current.selectedAnchor).toEqual(ANCHOR_REFERENCE.anchor)
    expect(result.current.selecting).toBe(false)

    postMessage.mockClear()
    postedMessages.length = 0
    act(() => result.current.startElementSelection())
    expect(postMessage).not.toHaveBeenCalled()

    act(() => result.current.handleFrameLoad())
    expect(result.current.selectedAnchor).toEqual(ANCHOR_REFERENCE.anchor)

    act(() => result.current.clearSelection())
    expect(postedMessages.at(-1)?.type).toBe("replica:bridge:clear-selection")
    expect(result.current.selectedAnchor).toBeNull()
  })
})
