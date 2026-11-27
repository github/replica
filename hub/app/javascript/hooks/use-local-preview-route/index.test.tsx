import { act, fireEvent, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useLocalPreviewRoute } from "."

describe("useLocalPreviewRoute()", () => {
  it("reports only current local-frame routes and releases polling on unmount", () => {
    vi.useFakeTimers()
    const frame = document.createElement("iframe")
    frame.src = "http://127.0.0.1:4321/settings"
    document.body.append(frame)
    const post = vi.spyOn(frame.contentWindow!, "postMessage")
    const changed = vi.fn()
    const frameRef = { current: frame }
    const view = renderHook(() =>
      useLocalPreviewRoute({
        frameRef,
        previewUrl: frame.src,
        onRouteChange: changed,
      }),
    )
    function nonce() {
      const message: unknown = post.mock.calls.at(-1)?.[0]
      if (!message || typeof message !== "object" || !("nonce" in message))
        throw new Error("Expected a local bridge handshake.")
      return message.nonce
    }
    const route = { pathname: "/details", search: "?view=compact", hash: "#item" }
    const initialNonce = nonce()
    function receive(
      messageNonce = initialNonce,
      origin = new URL(frame.src).origin,
      source: Window | null = frame.contentWindow,
      protocolVersion = 1,
      reportedRoute: unknown = route,
    ) {
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin,
            source,
            data: {
              type: "replica:canvas:ready",
              nonce: messageNonce,
              protocolVersion,
              route: reportedRoute,
              replaceRoute: true,
            },
          }),
        )
      })
    }
    try {
      receive(initialNonce, "http://localhost:3000")
      receive(initialNonce, new URL(frame.src).origin, window)
      receive("stale")
      receive(initialNonce, new URL(frame.src).origin, frame.contentWindow, 2)
      receive(initialNonce, new URL(frame.src).origin, frame.contentWindow, 1, { pathname: "bad" })
      expect(changed).not.toHaveBeenCalled()
      receive()
      expect(changed).toHaveBeenCalledWith(route, true)
      fireEvent.load(frame)
      changed.mockClear()
      receive(initialNonce)
      expect(changed).not.toHaveBeenCalled()
      receive(nonce())
      expect(changed).toHaveBeenCalledWith(route, true)
      act(() => {
        vi.advanceTimersByTime(1_000)
      })
      const requests = post.mock.calls.length
      view.unmount()
      act(() => {
        vi.advanceTimersByTime(2_000)
      })
      expect(post).toHaveBeenCalledTimes(requests)
    } finally {
      view.unmount()
      frame.remove()
    }
  })
})
