import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import type { AnchorReference } from "@utils/review-anchor/types"
import type { PreviewBridgeCommand, PreviewBridgeMessage } from "@utils/preview-bridge/types"

import { usePreviewBridge } from "."

const PREVIEW_URL = "http://b1.preview.replica.localhost:19500/"
const PREVIEW_ORIGIN = new URL(PREVIEW_URL).origin
const HUB_ORIGIN = "https://hub.example.test"
const HOSTED_PREVIEW_URL =
  `${HUB_ORIGIN}/api/repositories/2001/prototypes/1/builds/7/access?` +
  new URLSearchParams({ preview_origin: PREVIEW_ORIGIN, route: "/?tab=overview#top" }).toString()
const TEMPLATE_PREVIEW_URL = HOSTED_PREVIEW_URL.replace(
  "/prototypes/1/builds/7/",
  "/template-builds/7/",
)
const NAVIGATION_READY = "replica:bridge:request-navigation-ready"
const REQUEST_ID = "00000000-0000-4000-8000-000000000001"
const EMPTY_ANCHORS: AnchorReference[] = []
const ANCHOR_REFERENCE = {
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
} satisfies AnchorReference
const READY_MESSAGE = {
  protocolVersion: 1,
  requestId: "bridge-request",
  type: "replica:bridge:ready",
  payload: { route: { pathname: "/", search: "", hash: "" } },
} satisfies PreviewBridgeMessage

function renderHostedPreviewBridge({
  previewUrl = HOSTED_PREVIEW_URL,
  reviewEnabled = true,
  previewTheme = "light",
  anchors = EMPTY_ANCHORS,
}: {
  previewUrl?: string
  reviewEnabled?: boolean
  previewTheme?: "light" | "dark"
  anchors?: AnchorReference[]
} = {}) {
  const iframe = document.createElement("iframe")
  document.body.append(iframe)
  onTestFinished(() => iframe.remove())
  const frameWindow = iframe.contentWindow
  if (!frameWindow) throw new Error("Expected iframe content window")
  const iframeRef = { current: iframe }
  const postMessage = vi.spyOn(frameWindow, "postMessage").mockImplementation(() => {})
  const { result, rerender } = renderHook(
    ({ previewUrl }) =>
      usePreviewBridge({ iframeRef, previewUrl, previewTheme, anchors, reviewEnabled }),
    { initialProps: { previewUrl } },
  )

  function commandId(type: PreviewBridgeCommand["type"]) {
    const [command, targetOrigin] =
      postMessage.mock.calls.findLast(
        ([command]) => (command as PreviewBridgeCommand).type === type,
      ) ?? []
    if (!command) throw new Error(`Expected ${type} command`)
    expect(targetOrigin).toBe(PREVIEW_ORIGIN)
    return (command as PreviewBridgeCommand).requestId
  }

  function receive(
    data: PreviewBridgeMessage & { navigationId?: string },
    { origin = PREVIEW_ORIGIN, source }: { origin?: string; source?: Window } = {},
  ) {
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { origin, source: source ?? frameWindow, data }),
      )
    })
  }

  function load() {
    act(() => result.current.handleFrameLoad())
    const requestId = commandId(NAVIGATION_READY)
    expect(postMessage).toHaveBeenLastCalledWith(
      { protocolVersion: 1, requestId, type: NAVIGATION_READY, payload: {} },
      PREVIEW_ORIGIN,
    )
    return requestId
  }

  return { result, receive, load, commandId, rerender, postMessage, iframeRef }
}

describe("usePreviewBridge()", () => {
  it("requires a scoped reply from the current frame and Build origin for hosted readiness", () => {
    const { result, receive, load, iframeRef } = renderHostedPreviewBridge()
    const previousId = load()
    receive({ ...READY_MESSAGE, requestId: previousId, navigationId: previousId })
    expect(result.current.ready).toBe(true)

    const navigationId = load()
    expect(navigationId).not.toBe(previousId)
    const ready = { ...READY_MESSAGE, requestId: navigationId, navigationId }
    receive(ready, { origin: HUB_ORIGIN })
    receive(ready, { source: window })
    receive({ ...READY_MESSAGE, requestId: previousId })
    receive({ ...READY_MESSAGE, requestId: navigationId })
    receive({ ...ready, navigationId: previousId })
    receive({ ...ready, requestId: previousId })
    receive({ ...ready, requestId: previousId, navigationId: previousId })
    expect(result.current.ready).toBe(false)
    expect(result.current.route).toBeNull()

    const originalFrame = iframeRef.current
    const replacementFrame = document.createElement("iframe")
    document.body.append(replacementFrame)
    onTestFinished(() => replacementFrame.remove())
    const replacementWindow = replacementFrame.contentWindow
    if (!replacementWindow) throw new Error("Expected replacement iframe content window")
    iframeRef.current = replacementFrame
    receive(ready, { source: replacementWindow })
    expect(result.current.ready).toBe(false)

    iframeRef.current = originalFrame
    receive(ready)
    expect(result.current.ready).toBe(true)
    expect(result.current.route).toEqual(ready.payload.route)
  })

  it("rejects a pending reply after the access URL changes on the same Build origin", () => {
    const { result, receive, load, rerender } = renderHostedPreviewBridge()
    const previousId = load()
    rerender({ previewUrl: HOSTED_PREVIEW_URL.replace("overview", "details") })
    receive({ ...READY_MESSAGE, requestId: previousId, navigationId: previousId })
    expect(result.current.ready).toBe(false)
    expect(result.current.route).toBeNull()

    const navigationId = load()
    receive({ ...READY_MESSAGE, requestId: navigationId, navigationId })
    expect(result.current.ready).toBe(true)
  })

  it("ignores unscoped and previous-navigation anchor results but displays current anchors", () => {
    const { result, receive, load, commandId } = renderHostedPreviewBridge({
      anchors: [ANCHOR_REFERENCE],
    })
    const previousId = load()
    receive({ ...READY_MESSAGE, requestId: previousId, navigationId: previousId })
    const navigationId = load()
    receive({ ...READY_MESSAGE, requestId: navigationId, navigationId })
    const resolution = {
      commentId: ANCHOR_REFERENCE.commentId,
      status: "resolved",
      rect: { x: 20, y: 30, width: 100, height: 32 },
      point: { x: 70, y: 46 },
    } as const
    const reply = {
      protocolVersion: 1,
      requestId: commandId("replica:bridge:resolve-anchors"),
      type: "replica:bridge:anchors-resolved",
      payload: { results: [resolution] },
    } satisfies PreviewBridgeMessage
    receive(reply)
    receive({ ...reply, navigationId: previousId })
    expect(result.current.resolutions.size).toBe(0)

    receive({ ...reply, navigationId })
    expect(result.current.resolutions.get(resolution.commentId)).toEqual(resolution)
  })

  it("sends the theme but no review commands when an isolated template is ready", () => {
    const { result, receive, load, postMessage } = renderHostedPreviewBridge({
      previewUrl: TEMPLATE_PREVIEW_URL,
      reviewEnabled: false,
      previewTheme: "dark",
      anchors: [ANCHOR_REFERENCE],
    })
    const navigationId = load()
    receive({ ...READY_MESSAGE, requestId: navigationId })
    expect(result.current.ready).toBe(false)
    expect(postMessage).toHaveBeenCalledOnce()

    receive({ ...READY_MESSAGE, requestId: navigationId, navigationId })
    expect(result.current.ready).toBe(true)
    act(() => {
      result.current.startElementSelection()
      result.current.startAreaSelection()
      result.current.focusAnchor(1)
    })
    expect(result.current.selecting).toBe(false)
    expect(postMessage.mock.calls).toEqual([
      [expect.objectContaining({ type: NAVIGATION_READY }), PREVIEW_ORIGIN],
      [
        expect.objectContaining({ type: "replica:bridge:set-theme", payload: { theme: "dark" } }),
        PREVIEW_ORIGIN,
      ],
    ])
  })

  it("clears hosted selection on a changed SPA route and accepts only the new selection reply", () => {
    const { result, receive, load, commandId } = renderHostedPreviewBridge()
    const initialRoute = READY_MESSAGE.payload.route
    let navigationId = load()
    function reportReady(route: typeof initialRoute) {
      navigationId = commandId(NAVIGATION_READY)
      receive({ ...READY_MESSAGE, requestId: navigationId, navigationId, payload: { route } })
    }
    function reportRoute(route: typeof initialRoute) {
      receive({
        ...READY_MESSAGE,
        type: "replica:bridge:route-changed",
        requestId: "spa-route-change",
        navigationId,
        payload: { route },
      })
    }
    const element = {
      protocolVersion: 1,
      type: "replica:bridge:element-selected",
    } as const
    reportReady(initialRoute)

    act(() => result.current.startElementSelection())
    const firstSelection = {
      ...element,
      requestId: commandId("replica:bridge:select-element"),
      payload: { anchor: ANCHOR_REFERENCE.anchor },
    }
    receive(firstSelection)
    receive({ ...firstSelection, navigationId: "different-navigation" })
    expect(result.current.selectedAnchor).toBeNull()
    expect(result.current.selecting).toBe(true)

    receive({ ...firstSelection, navigationId })
    expect(result.current.selectedAnchor).toEqual(firstSelection.payload.anchor)
    reportRoute(initialRoute)
    expect(result.current.selectedAnchor).toEqual(firstSelection.payload.anchor)

    const secondRoute = { ...initialRoute, search: "?tab=details" }
    reportRoute(secondRoute)
    expect(result.current.route).toEqual(secondRoute)
    expect(result.current.selectedAnchor).toBeNull()
    reportReady(secondRoute)

    act(() => result.current.startElementSelection())
    const pendingSelection = {
      ...firstSelection,
      navigationId,
      requestId: commandId("replica:bridge:select-element"),
      payload: { anchor: { ...ANCHOR_REFERENCE.anchor, route: secondRoute } },
    }
    expect(result.current.selecting).toBe(true)

    const finalRoute = { ...secondRoute, hash: "#summary" }
    reportRoute(finalRoute)
    expect(result.current.route).toEqual(finalRoute)
    expect(result.current.selecting).toBe(false)
    reportReady(finalRoute)
    receive(pendingSelection)
    expect(result.current.selectedAnchor).toBeNull()

    act(() => result.current.startElementSelection())
    const currentRequestId = commandId("replica:bridge:select-element")
    receive(pendingSelection)
    expect(result.current.selectedAnchor).toBeNull()
    expect(result.current.selecting).toBe(true)

    const currentAnchor = { ...ANCHOR_REFERENCE.anchor, route: finalRoute }
    receive({
      ...pendingSelection,
      navigationId,
      requestId: currentRequestId,
      payload: { anchor: currentAnchor },
    })
    expect(result.current.selectedAnchor).toEqual(currentAnchor)
    expect(result.current.selecting).toBe(false)
  })

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
