import { renderHook } from "@testing-library/react"
import { expect, it, vi } from "vitest"

import { useReviewLiveUpdates } from "."

function installSockets() {
  vi.useFakeTimers()
  const sockets: TestSocket[] = []
  class TestSocket extends EventTarget {
    static CLOSING = 2
    readyState = 1
    send = vi.fn<(frame: string) => void>()
    constructor() {
      super()
      sockets.push(this)
    }
    close(code = 1000) {
      this.readyState = 3
      this.dispatchEvent(new CloseEvent("close", { code }))
    }
    receive(frame: unknown) {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) }))
    }
  }
  vi.stubGlobal("WebSocket", TestSocket)
  return sockets
}

const channel = "review:repository:prototype"

it("re-fetches confirmed subscriptions and reconnects without consuming review data from the socket", () => {
  const sockets = installSockets()
  const refresh = vi.fn()
  renderHook(() => useReviewLiveUpdates(channel, refresh))
  const first = sockets[0]
  if (!first) throw new Error("The review did not open a socket.")
  first.dispatchEvent(new Event("open"))
  expect(first.send).toHaveBeenCalledWith(JSON.stringify({ type: "subscribe", channel }))
  first.receive({ type: "subscribed", channel })
  expect(refresh).toHaveBeenCalledTimes(1)
  first.receive({
    type: "event",
    channel,
    event: { type: "changed", payload: { body: "not a signal" } },
  })
  expect(refresh).toHaveBeenCalledTimes(1)
  first.receive({ type: "event", channel, event: { type: "changed", payload: null } })
  expect(refresh).toHaveBeenCalledTimes(2)
  first.close()
  vi.advanceTimersByTime(1000)
  const second = sockets[1]
  if (!second) throw new Error("The review did not reconnect.")
  expect(refresh).toHaveBeenCalledTimes(3)
  second.dispatchEvent(new Event("open"))
  second.receive({ type: "subscribed", channel })
  expect(second.send).toHaveBeenCalledWith(JSON.stringify({ type: "subscribe", channel }))
  expect(refresh).toHaveBeenCalledTimes(4)
})

it.each(["subscribe denial", "access revoked"])(
  "refreshes once and stops retrying after %s",
  (denial) => {
    const sockets = installSockets()
    const refresh = vi.fn()
    const { rerender } = renderHook(({ scope }) => useReviewLiveUpdates(scope, refresh), {
      initialProps: { scope: channel },
    })
    const first = sockets[0]!
    if (denial === "subscribe denial") first.receive({ type: "error", code: "FORBIDDEN" })
    else first.close(4403)

    vi.advanceTimersByTime(60_000)
    window.dispatchEvent(new Event("focus"))
    expect(sockets).toHaveLength(1)
    expect(refresh).toHaveBeenCalledTimes(1)

    rerender({ scope: "review:repository:other-prototype" })
    expect(sockets).toHaveLength(2)
  },
)
