import { expect, vi } from "vitest"

export function reviewSockets() {
  const sockets: ReviewSocket[] = []
  const endpoint = new URL("/api/realtime", window.location.href)
  endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:"

  class ReviewSocket extends EventTarget {
    static CLOSING = 2
    readyState = 1
    send = vi.fn<(frame: string) => void>()

    constructor(url: URL) {
      super()
      expect(url.href).toBe(endpoint.href)
      sockets.push(this)
      queueMicrotask(() => {
        if (this.readyState === 1) this.dispatchEvent(new Event("open"))
      })
    }

    close() {
      this.readyState = 3
    }

    receive(frame: unknown) {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) }))
    }
  }

  vi.stubGlobal("WebSocket", ReviewSocket)
  return sockets
}
